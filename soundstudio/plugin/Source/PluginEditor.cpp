#include "PluginEditor.h"

namespace {
// The Roland P-6 look, as on the site: black body, white lettering, P-6 yellow,
// lime when you're live, and a level meter of step lights.
const juce::Colour body(0xff0f1011), panel(0xff1c1d20), ink(0xffececea), muted(0xff8b8c91), line(0xff2c2d31),
    yellow(0xffffcc00), lime(0xff9be33a), red(0xffe8321c), unlit(0xff2a2b2f);
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
    g.fillAll(body);
    auto r = getLocalBounds().reduced(18, 16);
    // wordmark
    g.setColour(ink); g.setFont(juce::FontOptions(20.0f, juce::Font::bold));
    auto top = r.removeFromTop(26);
    g.drawText("air", top.removeFromLeft(26), juce::Justification::centredLeft);
    g.setColour(yellow); g.drawText(".", top.removeFromLeft(7), juce::Justification::centredLeft);
    g.setColour(ink); g.drawText("band", top.removeFromLeft(52), juce::Justification::centredLeft);
    g.setColour(muted); g.setFont(juce::FontOptions(11.0f)); g.drawText("S E N D", top, juce::Justification::centredRight);
    r.removeFromTop(14);
    // status light + words
    auto row = r.removeFromTop(22);
    const auto light = row.removeFromLeft(14).toFloat().withSizeKeepingCentre(10.0f, 10.0f);
    const bool on = connected || (blink / 10) % 2 == 0;
    const auto c = connected ? lime : (on ? yellow : yellow.withAlpha(0.3f));
    if(connected || on){ g.setColour(c.withAlpha(0.25f)); g.fillRoundedRectangle(light.expanded(4.0f), 4.0f); }
    g.setColour(c); g.fillRoundedRectangle(light, 2.0f);
    row.removeFromLeft(10);
    g.setColour(ink); g.setFont(juce::FontOptions(14.0f, juce::Font::bold));
    g.drawText(connected ? "Live in air.band" : "Waiting for air.band", row, juce::Justification::centredLeft);
    r.removeFromTop(4);
    g.setColour(muted); g.setFont(juce::FontOptions(12.0f));
    g.drawText(connected ? "This track is your input in the jam." : "Open the air.band app and join a room.", r.removeFromTop(18), juce::Justification::centredLeft);
    // level: a row of 16 step lights (the last two turn red near clipping)
    r.removeFromTop(12);
    auto m = r.removeFromTop(10).toFloat();
    const float db = juce::Decibels::gainToDecibels(level, -60.0f), frac = juce::jlimit(0.0f, 1.0f, (db + 60.0f) / 60.0f);
    const int n = 16, lit = (int) std::ceil(frac * n - 1e-4f);
    const float gap = 4.0f, w = (m.getWidth() - gap * (n - 1)) / n;
    for(int i = 0; i < n; ++i){
        const auto cell = juce::Rectangle<float>(m.getX() + i * (w + gap), m.getY(), w, m.getHeight());
        const auto col = i < lit ? (i >= n - 2 ? red : yellow) : unlit;
        g.setColour(col); g.fillRoundedRectangle(cell, 2.0f);
    }
    juce::ignoreUnused(panel, line);
}
