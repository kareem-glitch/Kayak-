// Tests for the plugin's link to the app:
//  1. the resampler turns 44.1 kHz and 96 kHz into clean 48 kHz (right pitch, no clicks)
//  2. packets have exactly the layout the app decodes (desktop/engine/src/link.rs)
//  3. the real plugin, fed a track in DAW-sized blocks, streams it to a stand-in
//     app at 48 kHz and shows "connected" once the app answers
#include "../Source/PluginProcessor.h"
#include <cstdio>
#include <cmath>

static int failures = 0;
#define CHECK(cond, ...) do { if(cond) std::printf("ok   "); else { std::printf("FAIL "); ++failures; } std::printf(__VA_ARGS__); std::printf("\n"); } while(0)

// Frequency of a sine by counting upward zero crossings.
static double freqOf(const std::vector<float>& x, double rate){
    int n = 0; double first = -1, last = -1;
    for(size_t i = 1; i < x.size(); ++i) if(x[i - 1] < 0 && x[i] >= 0){ const double t = (i - 1) + (-x[i - 1]) / (x[i] - x[i - 1]); if(first < 0) first = t; last = t; ++n; }
    return n > 1 ? (n - 1) * rate / (last - first) : 0;
}

static void resamplerTest(double inRate){
    airband::Resampler rs; rs.prepare(inRate, 1);
    std::vector<float> out, in(512), tmp((size_t)rs.maxOut(512));
    double ph = 0;
    for(int block = 0; block < 200; ++block){
        const int n = 100 + (block * 37) % 400;   // uneven DAW blocks
        for(int i = 0; i < n; ++i){ in[(size_t)i] = 0.5f * (float)std::sin(ph); ph += 2 * M_PI * 440.0 / inRate; }
        const float* src[1] = { in.data() }; float* dst[1] = { tmp.data() };
        const int m = rs.process(src, n, dst);
        out.insert(out.end(), tmp.begin(), tmp.begin() + m);
    }
    std::vector<float> steady(out.begin() + 1000, out.end());
    double jump = 0; for(size_t i = 1; i < steady.size(); ++i) jump = std::max(jump, (double)std::abs(steady[i] - steady[i - 1]));
    const double expected = 0.5 * 2 * M_PI * 440.0 / 48000.0;   // biggest step of a clean 440 Hz sine at 48 kHz
    CHECK(std::abs(freqOf(steady, 48000.0) - 440.0) < 0.5, "%g Hz -> 48 kHz keeps the pitch (%.2f Hz)", inRate, freqOf(steady, 48000.0));
    CHECK(jump < expected * 1.05, "%g Hz -> 48 kHz has no clicks at block edges (largest step %.4f, clean %.4f)", inRate, jump, expected);
}

static void packetTest(){
    float l[128], r[128]; for(int i = 0; i < 128; ++i){ l[i] = i * 0.01f; r[i] = -i * 0.01f; }
    const float* planes[2] = { l, r }; uint8_t pkt[16 + 128 * 8];
    const int len = airband::encodePacket(pkt, 2, 128, 0x01020304u, 6.5f, planes);
    float lat, r5; std::memcpy(&lat, pkt + 12, 4); std::memcpy(&r5, pkt + 16 + 128 * 4 + 5 * 4, 4);
    CHECK(len == 16 + 2 * 128 * 4, "packet size (%d bytes)", len);
    CHECK(std::memcmp(pkt, "AIRB", 4) == 0 && pkt[4] == 1 && pkt[5] == 2 && pkt[6] == 128 && pkt[7] == 0, "header: magic, version, channels, frames");
    CHECK(pkt[8] == 4 && pkt[9] == 3 && pkt[10] == 2 && pkt[11] == 1 && lat == 6.5f, "header: sequence and latency, little-endian");
    CHECK(r5 == r[5], "right channel follows the left");
}

static void pluginTest(){
    juce::DatagramSocket app(false); app.bindToPort(0, "127.0.0.1");
    AirBandSendProcessor p; p.link.port = app.getBoundPort();
    p.setPlayConfigDetails(2, 2, 44100.0, 256);
    p.prepareToPlay(44100.0, 256);
    juce::AudioBuffer<float> buf(2, 256); juce::MidiBuffer midi;
    double ph = 0; int packets = 0, frames = 0; bool okHeader = true;
    uint8_t in[4096]; juce::String fromIp; int fromPort = 0;
    std::vector<float> got;
    for(int block = 0; block < 172; ++block){   // 1 s at 44.1 kHz
        for(int i = 0; i < 256; ++i){ const float v = 0.4f * (float)std::sin(ph); ph += 2 * M_PI * 220.0 / 44100.0; buf.setSample(0, i, v); buf.setSample(1, i, v); }
        juce::AudioBuffer<float> before(buf);
        p.processBlock(buf, midi);
        if(block == 0){ bool same = true; for(int i = 0; i < 256; ++i) same &= buf.getSample(0, i) == before.getSample(0, i); CHECK(same, "the track passes through untouched"); }
        juce::Thread::sleep(5);
        while(app.waitUntilReady(true, 0) == 1){
            const int n = app.read(in, sizeof(in), false, fromIp, fromPort);
            if(n <= 0) break;
            ++packets; okHeader &= std::memcmp(in, "AIRB", 4) == 0 && in[5] == 2;
            const int f = in[6] | (in[7] << 8); frames += f;
            for(int i = 0; i < f; ++i){ float v; std::memcpy(&v, in + 16 + i * 4, 4); got.push_back(v); }
            if(packets % 20 == 1) app.write(fromIp, fromPort, "AIRA\x01", 5);   // the app answers now and then
        }
    }
    juce::Thread::sleep(100);
    CHECK(packets > 300 && okHeader, "streams packets to the app (%d, stereo)", packets);
    CHECK(std::abs(frames - 48000) < 600, "about 1 s of audio at 48 kHz (%d frames)", frames);
    std::vector<float> steady(got.begin() + 1000, got.end());
    CHECK(std::abs(freqOf(steady, 48000.0) - 220.0) < 0.5, "the app receives the right pitch (%.2f Hz)", freqOf(steady, 48000.0));
    CHECK(p.link.connected(), "shows connected once the app answers");
    p.releaseResources();
}

int main(){
    juce::ScopedJuceInitialiser_GUI init;
    resamplerTest(44100.0); resamplerTest(96000.0); resamplerTest(48000.0);
    packetTest();
    pluginTest();
    std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
