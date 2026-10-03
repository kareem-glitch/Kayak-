// The plugin's small window, in airband's faceplate style: a jewel light
// (green when the app is receiving), a line of plain status, and a level meter.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"

class AirBandSendEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit AirBandSendEditor(AirBandSendProcessor&);
    void paint(juce::Graphics&) override;
private:
    void timerCallback() override;
    AirBandSendProcessor& proc;
    float level = 0.0f; bool connected = false; int blink = 0;
};
