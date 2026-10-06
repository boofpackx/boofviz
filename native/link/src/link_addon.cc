// Minimal Node-API binding for Ableton Link, used by BOOFVIZ's main process.
// Polling only (no callbacks across threads): the app reads a snapshot of the
// session timeline a few times per second and anchors its beat clock to it.
//
// Ableton Link is GPLv2+ (or a proprietary licence from Ableton). This file is
// BOOFVIZ glue; the Link SDK itself is fetched at build time into vendor/.
#include <napi.h>
#include <ableton/Link.hpp>

#include <cmath>
#include <memory>

class LinkSession : public Napi::ObjectWrap<LinkSession> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function ctor = DefineClass(env, "LinkSession", {
      InstanceMethod("enable", &LinkSession::Enable),
      InstanceMethod("isEnabled", &LinkSession::IsEnabled),
      InstanceMethod("numPeers", &LinkSession::NumPeers),
      InstanceMethod("snapshot", &LinkSession::Snapshot),
      InstanceMethod("setTempo", &LinkSession::SetTempo),
      InstanceMethod("clockMicros", &LinkSession::ClockMicros),
      InstanceMethod("close", &LinkSession::Close),
    });
    exports.Set("LinkSession", ctor);
    return exports;
  }

  explicit LinkSession(const Napi::CallbackInfo& info) : Napi::ObjectWrap<LinkSession>(info) {
    const double bpm = info.Length() > 0 && info[0].IsNumber() ? info[0].As<Napi::Number>().DoubleValue() : 120.0;
    link_ = std::make_unique<ableton::Link>(bpm);
  }

private:
  std::unique_ptr<ableton::Link> link_;

  bool Alive(const Napi::CallbackInfo& info) {
    if (!link_) {
      Napi::Error::New(info.Env(), "Link session is closed").ThrowAsJavaScriptException();
      return false;
    }
    return true;
  }

  Napi::Value Enable(const Napi::CallbackInfo& info) {
    if (!Alive(info)) return info.Env().Undefined();
    link_->enable(info.Length() > 0 && info[0].ToBoolean().Value());
    return info.Env().Undefined();
  }

  Napi::Value IsEnabled(const Napi::CallbackInfo& info) {
    if (!Alive(info)) return info.Env().Undefined();
    return Napi::Boolean::New(info.Env(), link_->isEnabled());
  }

  Napi::Value NumPeers(const Napi::CallbackInfo& info) {
    if (!Alive(info)) return info.Env().Undefined();
    return Napi::Number::New(info.Env(), static_cast<double>(link_->numPeers()));
  }

  // snapshot(quantum) → { micros, tempo, beat, phase, playing, peers }
  // `micros` is Link's clock at the moment the beat was evaluated.
  Napi::Value Snapshot(const Napi::CallbackInfo& info) {
    if (!Alive(info)) return info.Env().Undefined();
    const double quantum = info.Length() > 0 && info[0].IsNumber() ? info[0].As<Napi::Number>().DoubleValue() : 4.0;
    const auto state = link_->captureAppSessionState();
    const auto now = link_->clock().micros();
    Napi::Object out = Napi::Object::New(info.Env());
    out.Set("micros", static_cast<double>(now.count()));
    out.Set("tempo", state.tempo());
    out.Set("beat", state.beatAtTime(now, quantum));
    out.Set("phase", state.phaseAtTime(now, quantum));
    out.Set("playing", state.isPlaying());
    out.Set("peers", static_cast<double>(link_->numPeers()));
    return out;
  }

  Napi::Value SetTempo(const Napi::CallbackInfo& info) {
    if (!Alive(info)) return info.Env().Undefined();
    if (info.Length() < 1 || !info[0].IsNumber()) return info.Env().Undefined();
    auto state = link_->captureAppSessionState();
    state.setTempo(info[0].As<Napi::Number>().DoubleValue(), link_->clock().micros());
    link_->commitAppSessionState(state);
    return info.Env().Undefined();
  }

  Napi::Value ClockMicros(const Napi::CallbackInfo& info) {
    if (!Alive(info)) return info.Env().Undefined();
    return Napi::Number::New(info.Env(), static_cast<double>(link_->clock().micros().count()));
  }

  Napi::Value Close(const Napi::CallbackInfo& info) {
    if (link_) {
      link_->enable(false);
      link_.reset();
    }
    return info.Env().Undefined();
  }
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return LinkSession::Init(env, exports);
}

NODE_API_MODULE(boofviz_link, InitAll)
