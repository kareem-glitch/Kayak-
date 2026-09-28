// air.band Send: passes your track through untouched and streams it to the
// air.band app (see Link.h). No settings: drop it on the track and play.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "Link.h"

class AirBandSendProcessor : public juce::AudioProcessor {
public:
    AirBandSendProcessor();
    void prepareToPlay(double sampleRate, int maxBlockSize) override;
    void releaseResources() override { link.stop(); }
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using juce::AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "air.band Send"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override {}
    void setStateInformation(const void*, int) override {}

    airband::Link link;
};
