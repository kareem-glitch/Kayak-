# air.band Send: a plugin you put on a track in your DAW. It passes the track
# through untouched and streams it to the air.band desktop app on the same
# computer, which uses it as your input (desktop/src-tauri/src/plugin.rs).
# Builds AU + VST3 on Mac and VST3 on Windows (and Linux, for tests).
cmake_minimum_required(VERSION 3.22)
project(AirBandSend VERSION 0.5.1 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)

include(FetchContent)
FetchContent_Declare(JUCE GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.15 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

set(FORMATS VST3)
if(APPLE)
  list(APPEND FORMATS AU)
endif()

juce_add_plugin(AirBandSend
  PRODUCT_NAME "air.band Send"
  COMPANY_NAME "air.band"
  BUNDLE_ID app.airband.send
  PLUGIN_MANUFACTURER_CODE Airb
  PLUGIN_CODE AbSd
  FORMATS ${FORMATS}
  IS_SYNTH FALSE
  NEEDS_MIDI_INPUT FALSE
  NEEDS_MIDI_OUTPUT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  COPY_PLUGIN_AFTER_BUILD FALSE
  VST3_CATEGORIES Fx Tools
  AU_MAIN_TYPE kAudioUnitType_Effect)

target_sources(AirBandSend PRIVATE Source/PluginProcessor.cpp Source/PluginEditor.cpp)
target_compile_definitions(AirBandSend PUBLIC
  JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0 JUCE_DISPLAY_SPLASH_SCREEN=0)
target_link_libraries(AirBandSend PRIVATE juce::juce_audio_utils
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)

# Tests (resampler, packet format, and the plugin streaming to a stand-in app)
option(AIRBAND_TESTS "Build the tests" OFF)
if(AIRBAND_TESTS)
  juce_add_console_app(AirBandSendTests PRODUCT_NAME "AirBandSendTests")
  target_sources(AirBandSendTests PRIVATE Tests/LinkTest.cpp)
  target_compile_definitions(AirBandSendTests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
  target_link_libraries(AirBandSendTests PRIVATE AirBandSend juce::juce_audio_utils juce::juce_recommended_config_flags)
endif()
