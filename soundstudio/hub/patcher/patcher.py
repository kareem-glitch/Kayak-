#!/usr/bin/env python3
"""SoundStudio room patcher.

The JackTrip hub runs with automatic patching off (-p 5), so every connected
client starts out hearing nothing and being heard by nobody. This process
watches JACK and wires clients together per room:

  * A client's JACK name is the `name` it gave the hub, which SoundStudio's API
    mints as  <room>.<pid>.<role>.<exp>.<sig>  (see sign_name below).
  * Clients with a bad signature, an expired name, or any other name get no
    connections at all. This is the hub's only access control for browsers,
    because JackTrip's -A authentication does not cover WebRTC/WebTransport.
  * Within a room everyone hears everyone else (mix-minus): a client never
    hears itself, and never hears other clients with the same pid. That is how
    the host's band channel reaches everyone except the host, who monitors the
    band locally with no network delay.
  * Role "b" (band) clients only send; nothing is routed to them.

Environment: HUB_SECRET (required), PATCHER_INTERVAL seconds (default 1).
"""

import base64
import hashlib
import hmac
import os
import re
import sys
import threading
import time

NAME_RE = re.compile(
    r"^(?P<room>[0-9a-f]{10})\.(?P<pid>[a-z0-9]{8})\.(?P<role>[pb])"
    r"\.(?P<exp>[0-9a-z]{1,8})\.(?P<sig>[A-Za-z0-9_-]{16})(?:-\d+)?$"
)
IGNORED_CLIENTS = {"system", "ss-patcher"}


def room_tag(room):
    return hashlib.sha256(room.encode()).hexdigest()[:10]


def _sig(secret, body):
    mac = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode()[:16]


def sign_name(secret, room, pid, role, exp):
    """Reference implementation of the name format; api/token.js mirrors it."""
    body = f"{room_tag(room)}.{pid}.{role}.{_to36(exp)}"
    return f"{body}.{_sig(secret, body)}"


def _to36(n):
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        n, r = divmod(n, 36)
        out = digits[r] + out
        if n == 0:
            return out


def parse_name(secret, name, now):
    """Returns (room, pid, role) for a valid, unexpired name, else None."""
    m = NAME_RE.match(name)
    if not m:
        return None
    body = f"{m['room']}.{m['pid']}.{m['role']}.{m['exp']}"
    if not hmac.compare_digest(_sig(secret, body), m["sig"]):
        return None
    if int(m["exp"], 36) < now:
        return None
    return m["room"], m["pid"], m["role"]


def _channel_ports(ports, prefix):
    """receive_1, receive_2... sorted by channel number; ignores broadcast ports."""
    found = []
    for p in ports:
        short = p.split(":", 1)[1]
        m = re.fullmatch(prefix + r"_(\d+)", short)
        if m:
            found.append((int(m.group(1)), p))
    return [p for _, p in sorted(found)]


def desired_connections(ports_by_client, members):
    """ports_by_client: {client: [full port names]}; members: {client: (room, pid, role)}.

    JackTrip names the ports that carry audio *from* the network receive_N
    (JACK outputs) and the ports that carry audio *to* the network send_N
    (JACK inputs). Returns a set of (source_port, destination_port).
    """
    want = set()
    for src, (room, pid, _) in members.items():
        outs = _channel_ports(ports_by_client.get(src, []), "receive")
        for dst, (droom, dpid, drole) in members.items():
            if droom != room or dpid == pid or drole == "b":
                continue
            ins = _channel_ports(ports_by_client.get(dst, []), "send")
            if not outs or not ins:
                continue
            if len(outs) == 1:
                want.update((outs[0], i) for i in ins)  # mono source to every channel
            elif len(ins) == 1:
                want.update((o, ins[0]) for o in outs)  # fold stereo into mono listener
            else:
                want.update(zip(outs, ins))
    return want


def main():
    import jack  # python3-jack-client; imported here so the logic above is testable without JACK

    secret = os.environ.get("HUB_SECRET", "")
    if not secret:
        sys.exit("ss-patcher: HUB_SECRET is not set")
    interval = float(os.environ.get("PATCHER_INTERVAL", "1"))

    client = jack.Client("ss-patcher", no_start_server=True)
    changed = threading.Event()
    # JACK forbids graph changes inside its callbacks, so they only wake the loop.
    client.set_port_registration_callback(lambda *a: changed.set(), only_available=False)
    client.set_port_connect_callback(lambda *a: changed.set(), only_available=False)
    client.set_client_registration_callback(lambda *a: changed.set())
    client.activate()
    print("ss-patcher: running", flush=True)

    admitted = {}  # client name -> (room, pid, role); checked once, when first seen
    while True:
        changed.wait(interval)
        changed.clear()
        try:
            ports_by_client = {}
            for p in client.get_ports():
                owner = p.name.split(":", 1)[0]
                if owner not in IGNORED_CLIENTS:
                    ports_by_client.setdefault(owner, []).append(p.name)

            for gone in set(admitted) - set(ports_by_client):
                print(f"ss-patcher: left {gone}", flush=True)
                del admitted[gone]
            now = int(time.time())
            for name in set(ports_by_client) - set(admitted):
                info = parse_name(secret, name, now)
                if info:
                    admitted[name] = info
                    print(f"ss-patcher: joined room {info[0]} as {name}", flush=True)
                elif name not in _rejected:
                    _rejected.add(name)
                    print(f"ss-patcher: ignoring unauthorised client {name}", flush=True)

            want = desired_connections(ports_by_client, admitted)
            have = set()
            for ports in ports_by_client.values():
                for pname in ports:
                    port = client.get_port_by_name(pname)
                    if port.is_output:
                        have.update((pname, c.name) for c in client.get_all_connections(port))
                    else:
                        have.update((c.name, pname) for c in client.get_all_connections(port))
            for a, b in have - want:
                client.disconnect(a, b)
            for a, b in want - have:
                client.connect(a, b)
        except jack.JackError as e:
            # Ports can vanish mid-pass when a client leaves; the next pass fixes it up.
            print(f"ss-patcher: {e}", flush=True)
            changed.set()
            time.sleep(0.05)


_rejected = set()

if __name__ == "__main__":
    main()
