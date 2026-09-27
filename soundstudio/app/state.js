// Room state shared by everyone in the room (the band host is the source of
// truth and broadcasts it), plus who "I" am on this device.
export const PROTOCOL_VERSION = 1;   // bump when control messages change shape

export const S = {
  arr: null, playing: false, hostId: null, hostName: '',
  levels: { drums:0, bass:0, keys:0, guitar:0 },   // part levels in dB, set by the host, applied on every device
  seats: [
    { id:'drums', label:'Drums', human:false, who:'' },
    { id:'bass', label:'Bass', human:false, who:'' },
    { id:'keys', label:'Keys', human:false, who:'' },
    { id:'guitar', label:'Rhythm guitar', human:false, who:'' }
  ]
};

// isHost: this device runs the band (controls prompt, play, seats).
export const me = { id: '', name: '', isHost: false };
