import unittest

from patcher import desired_connections, parse_name, room_tag, sign_name

S = "test-secret"
NOW = 1_800_000_000


def ports(name, n_recv, n_send):
    return [f"{name}:receive_{i}" for i in range(1, n_recv + 1)] + [
        f"{name}:send_{i}" for i in range(1, n_send + 1)
    ]


class NameTests(unittest.TestCase):
    def test_round_trip(self):
        n = sign_name(S, "jam-ab12c", "abcd1234", "p", NOW + 60)
        self.assertEqual(parse_name(S, n, NOW), (room_tag("jam-ab12c"), "abcd1234", "p"))
        self.assertLessEqual(len(n), 63)  # JACK client name limit

    def test_jack_duplicate_suffix_accepted(self):
        n = sign_name(S, "r", "abcd1234", "p", NOW + 60)
        self.assertIsNotNone(parse_name(S, n + "-01", NOW))

    def test_rejects_wrong_secret_expired_tampered_and_random(self):
        n = sign_name(S, "r", "abcd1234", "p", NOW + 60)
        self.assertIsNone(parse_name("other", n, NOW))
        self.assertIsNone(parse_name(S, n, NOW + 61))
        self.assertIsNone(parse_name(S, n.replace(".p.", ".b."), NOW))
        self.assertIsNone(parse_name(S, "81.2.3.4", NOW))


class RoutingTests(unittest.TestCase):
    def test_mix_minus_rooms_band_and_strangers(self):
        r1, r2 = room_tag("one"), room_tag("two")
        pbc = {
            "alice": ports("alice", 1, 2),     # mono player, stereo return
            "host": ports("host", 1, 2),
            "band": ports("band", 2, 1),       # host's band, stereo
            "carol": ports("carol", 1, 2),     # other room
            "stranger": ports("stranger", 1, 2),  # not admitted
        }
        members = {
            "alice": (r1, "aaaaaaaa", "p"),
            "host": (r1, "hhhhhhhh", "p"),
            "band": (r1, "hhhhhhhh", "b"),
            "carol": (r2, "cccccccc", "p"),
        }
        want = desired_connections(pbc, members)
        # alice hears host (mono upmixed) and the band in stereo
        self.assertIn(("host:receive_1", "alice:send_1"), want)
        self.assertIn(("host:receive_1", "alice:send_2"), want)
        self.assertIn(("band:receive_1", "alice:send_1"), want)
        self.assertIn(("band:receive_2", "alice:send_2"), want)
        # host hears alice but not their own band; nobody hears themselves
        self.assertIn(("alice:receive_1", "host:send_1"), want)
        self.assertFalse(any(a.startswith("band:") and b.startswith("host:") for a, b in want))
        self.assertFalse(any(a.split(":")[0] == b.split(":")[0] for a, b in want))
        # nothing is sent to the band, across rooms, or to/from strangers
        self.assertFalse(any(b.startswith("band:") for _, b in want))
        self.assertFalse(any("carol" in a or "carol" in b for a, b in want))
        self.assertFalse(any("stranger" in a or "stranger" in b for a, b in want))
        self.assertEqual(len(want), 2 + 2 + 2)  # alice<-host(2) alice<-band(2) host<-alice(2)


if __name__ == "__main__":
    unittest.main()
