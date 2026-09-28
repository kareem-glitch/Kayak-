#include "PluginEditor.h"

namespace {
const juce::Colour plate(0xffe9e7e1), ink(0xff1d1c1a), muted(0xff7a766d), line(0xffcfcbc2), orange(0xfff26b1d), green(0xff1fae62), amber(0xffe0a019);
}

AirBandSendEditor::AirBandSendEditor(AirBandSendProcessor& p) : AudioProcessorEditor(p), proc(p) {
    setSize(340, 150);
    startTimerHz(20);
}

void AirBandSendEditor::timerCallback() {
    const float pk = proc.link.takePeak();
    level = juce::jmax(pk, level * 0.85f);
    connected = proc.link.connected();
    ++blink;
    repaint();
}

void AirBandSendEditor::paint(juce::Graphics& g) {
    g.fillAll(plate);
    auto r = getLocalBounds().reduced(18, 16);
    // wordmark
    g.setColour(ink); g.setFont(juce::FontOptions(20.0f, juce::Font::bold));
    auto top = r.removeFromTop(26);
    g.drawText("air", top.removeFromLeft(26), juce::Justification::centredLeft);
    g.setColour(orange); g.drawText(".", top.removeFromLeft(7), juce::Justification::centredLeft);
    g.setColour(ink); g.drawText("band", top.removeFromLeft(52), juce::Justification::centredLeft);
    g.setColour(muted); g.setFont(juce::FontOptions(11.0f)); g.drawText("SEND", top, juce::Justification::centredRight);
    r.removeFromTop(14);
    // jewel + status
    auto row = r.removeFromTop(22);
    const auto jewel = row.removeFromLeft(14).toFloat().withSizeKeepingCentre(12.0f, 12.0f);
    const bool on = connected || (blink / 10) % 2 == 0;
    g.setColour(line); g.fillEllipse(jewel.expanded(2.0f));
    g.setColour(connected ? green : (on ? amber : amber.withAlpha(0.35f))); g.fillEllipse(jewel);
    if(connected){ g.setColour(green.withAlpha(0.25f)); g.fillEllipse(jewel.expanded(5.0f)); }
    row.removeFromLeft(10);
    g.setColour(ink); g.setFont(juce::FontOptions(14.0f, juce::Font::bold));
    g.drawText(connected ? "Live in air.band" : "Waiting for air.band", row, juce::Justification::centredLeft);
    r.removeFromTop(4);
    g.setColour(muted); g.setFont(juce::FontOptions(12.0f));
    g.drawText(connected ? "This track is your input in the jam." : "Open the air.band app and join a room.", r.removeFromTop(18), juce::Justification::centredLeft);
    // level meter
    r.removeFromTop(12);
    auto m = r.removeFromTop(8).toFloat();
    g.setColour(line); g.fillRoundedRectangle(m, 4.0f);
    const float db = juce::Decibels::gainToDecibels(level, -60.0f), w = juce::jlimit(0.0f, 1.0f, (db + 60.0f) / 60.0f);
    g.setColour(db > -1.0f ? juce::Colour(0xffd6452a) : ink); g.fillRoundedRectangle(m.withWidth(m.getWidth() * w), 4.0f);
}
