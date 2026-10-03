// The plugin's side of the link to the airband app (same computer, UDP on
// 127.0.0.1). Packet format: see desktop/engine/src/link.rs.
//   audio thread:  push()  resamples your track to 48 kHz into a lock-free queue
//   sender thread: sends it in packets of 128 frames, reads the app's replies
// Nothing on the audio thread allocates, locks or touches the network.
#pragma once
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <atomic>
#include <cstring>

namespace airband {

constexpr int kPort = 47810;
constexpr double kRate = 48000.0;
constexpr int kFrames = 128;
constexpr uint8_t kVersion = 1;

// Streaming resampler (Catmull-Rom), all channels in lockstep. 48 kHz in is
// passed straight through; other rates are converted smoothly block to block.
class Resampler {
public:
    void prepare(double inRate, int channels){
        step = inRate / kRate; chans = channels; pos = 0.0;
        for(auto& h : hist) std::fill(std::begin(h), std::end(h), 0.0f);
    }
    bool passthrough() const { return std::abs(step - 1.0) < 1e-9; }
    int maxOut(int numIn) const { return (int)std::ceil(numIn / step) + 4; }
    // Converts numIn frames; writes up to maxOut(numIn) frames per channel; returns how many.
    int process(const float* const* in, int numIn, float* const* out){
        if(passthrough()){ for(int c = 0; c < chans; ++c) std::memcpy(out[c], in[c], sizeof(float) * (size_t)numIn); return numIn; }
        // sample i of the virtual input: the last 3 frames of the previous block, then this block
        auto at = [&](int c, int i){ return i < 0 ? hist[c][3 + i] : in[c][i]; };
        int n = 0;
        while(pos < numIn - 2){
            const int i = (int)std::floor(pos); const float t = (float)(pos - i);
            for(int c = 0; c < chans; ++c){
                const float p0 = at(c, i - 1), p1 = at(c, i), p2 = at(c, i + 1), p3 = at(c, i + 2);
                out[c][n] = p1 + 0.5f * t * (p2 - p0 + t * (2.0f * p0 - 5.0f * p1 + 4.0f * p2 - p3 + t * (3.0f * (p1 - p2) + p3 - p0)));
            }
            ++n; pos += step;
        }
        pos -= numIn;
        for(int c = 0; c < chans; ++c) for(int k = 0; k < 3; ++k) hist[c][k] = at(c, numIn - 3 + k);
        return n;
    }
private:
    double step = 1.0, pos = 0.0; int chans = 1; float hist[2][3] {};
};

// One packet: header then each channel's frames. Returns its size in bytes.
inline int encodePacket(uint8_t* dst, int channels, int frames, uint32_t seq, float latencyMs, const float* const* planes){
    std::memcpy(dst, "AIRB", 4); dst[4] = kVersion; dst[5] = (uint8_t)channels;
    const uint16_t f = (uint16_t)frames; std::memcpy(dst + 6, &f, 2);          // little-endian on every platform we build for
    std::memcpy(dst + 8, &seq, 4); std::memcpy(dst + 12, &latencyMs, 4);
    for(int c = 0; c < channels; ++c) std::memcpy(dst + 16 + c * frames * 4, planes[c], sizeof(float) * (size_t)frames);
    return 16 + channels * frames * 4;
}

class Link : private juce::Thread {
public:
    Link() : juce::Thread("airband link") {}
    ~Link() override { stop(); }

    // Audio settings changed (or first use): sampleRate, the DAW's block size, channels (1 or 2).
    void prepare(double sampleRate, int blockSize, int channels){
        stop();
        chans = juce::jlimit(1, 2, channels);
        resampler.prepare(sampleRate, chans);
        latencyMs.store((float)(blockSize / sampleRate * 1000.0 + 1.5));
        const int cap = (int)kRate;   // 1 s of queue
        fifo.setTotalSize(cap);
        for(auto& r : ring) r.assign((size_t)cap, 0.0f);
        const int tmpLen = resampler.maxOut(juce::jmax(blockSize, 32) * 4);
        for(auto& t : tmp) t.assign((size_t)tmpLen, 0.0f);
        startThread(juce::Thread::Priority::high);
    }
    void stop(){ signalThreadShouldExit(); wake.signal(); stopThread(500); }

    // Audio thread: your track's audio (read-only). Big DAW blocks are taken in slices.
    void push(const float* const* in, int numChannels, int numFrames){
        if(numChannels <= 0 || tmp[0].empty()) return;   // not prepared yet
        float pk = 0.0f;
        for(int c = 0; c < juce::jmin(numChannels, chans); ++c) for(int i = 0; i < numFrames; ++i) pk = juce::jmax(pk, std::abs(in[c][i]));
        if(pk > peak.load()) peak.store(pk);
        const int slice = (int)(tmp[0].size() - 4) / 2;
        for(int start = 0; start < numFrames; start += slice){
            const int n = juce::jmin(slice, numFrames - start);
            const float* src[2] = { in[0] + start, in[numChannels > 1 && chans > 1 ? 1 : 0] + start };
            float* dst[2] = { tmp[0].data(), tmp[1].data() };
            const int out = resampler.process(src, n, dst);
            int s1, n1, s2, n2; fifo.prepareToWrite(out, s1, n1, s2, n2);
            for(int c = 0; c < chans; ++c){
                if(n1 > 0) std::memcpy(ring[c].data() + s1, dst[c], sizeof(float) * (size_t)n1);
                if(n2 > 0) std::memcpy(ring[c].data() + s2, dst[c] + n1, sizeof(float) * (size_t)n2);
            }
            fifo.finishedWrite(n1 + n2);   // if the queue is full (app gone for a while), the rest is dropped
        }
        wake.signal();
    }

    // For the window: is the app answering, and how loud is the track.
    bool connected() const { const auto t = lastAck.load(); return t != 0 && juce::Time::getMillisecondCounter() - t < 1500; }
    float takePeak(){ return peak.exchange(0.0f); }
    int port = kPort;   // tests point this elsewhere

private:
    void run() override {
        juce::DatagramSocket sock(false);
        sock.bindToPort(0, "127.0.0.1");
        uint8_t pkt[16 + kFrames * 2 * 4], in[64];
        float a[kFrames], b[kFrames];
        uint32_t seq = 0;
        while(!threadShouldExit()){
            wake.wait(5);
            while(fifo.getNumReady() >= kFrames && !threadShouldExit()){
                int s1, n1, s2, n2; fifo.prepareToRead(kFrames, s1, n1, s2, n2);
                float* planes[2] = { a, b };
                for(int c = 0; c < chans; ++c){
                    std::memcpy(planes[c], ring[c].data() + s1, sizeof(float) * (size_t)n1);
                    if(n2 > 0) std::memcpy(planes[c] + n1, ring[c].data() + s2, sizeof(float) * (size_t)n2);
                }
                fifo.finishedRead(n1 + n2);
                const int len = encodePacket(pkt, chans, kFrames, seq++, latencyMs.load(), planes);
                sock.write("127.0.0.1", port, pkt, len);
            }
            while(sock.waitUntilReady(true, 0) == 1){
                const int n = sock.read(in, sizeof(in), false);
                if(n >= 5 && std::memcmp(in, "AIRA", 4) == 0) lastAck.store(juce::Time::getMillisecondCounter());
                if(n <= 0) break;
            }
        }
    }

    Resampler resampler;
    int chans = 1;
    juce::AbstractFifo fifo { 2 };
    std::vector<float> ring[2], tmp[2];
    juce::WaitableEvent wake;
    std::atomic<float> latencyMs { 0.0f }, peak { 0.0f };
    std::atomic<uint32_t> lastAck { 0 };
};

} // namespace airband
