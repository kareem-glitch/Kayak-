#include "PluginProcessor.h"
#include "PluginEditor.h"

AirBandSendProcessor::AirBandSendProcessor()
    : AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true)
                                      .withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}

// Mono or stereo, the same in and out.
bool AirBandSendProcessor::isBusesLayoutSupported(const BusesLayout& l) const {
    const auto in = l.getMainInputChannelSet(), out = l.getMainOutputChannelSet();
    return in == out && (in == juce::AudioChannelSet::mono() || in == juce::AudioChannelSet::stereo());
}

void AirBandSendProcessor::prepareToPlay(double sampleRate, int maxBlockSize) {
    link.prepare(sampleRate, maxBlockSize, getTotalNumInputChannels());
}

void AirBandSendProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    // the track's audio is left exactly as it is; a copy goes to airband
    link.push(buffer.getArrayOfReadPointers(), juce::jmin(buffer.getNumChannels(), getTotalNumInputChannels()), buffer.getNumSamples());
}

juce::AudioProcessorEditor* AirBandSendProcessor::createEditor() { return new AirBandSendEditor(*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new AirBandSendProcessor(); }
