/* View: Voice-to-Voice Healthcare AI Assistant.
 *
 * Browser-native pipeline (no external SDK on the client):
 *   1. Speech-to-Text  — Web Speech API (SpeechRecognition / webkitSpeechRecognition)
 *   2. Reasoning       — same-origin POST /api/assistant → Groq Cloud (qwen/qwen3.6-27b)
 *   3. Text-to-Speech  — window.speechSynthesis
 *
 * Token frugality (Groq free tier): only the last few short turns are kept in
 * memory and forwarded; each turn is trimmed; the server caps output tightly.
 *
 * Animated visualizers reflect the state machine:
 *   idle → listening → thinking → speaking → idle
 */
(function () {
  "use strict";
  var C = (window.Vaidyam = window.Vaidyam || {});
  var V = (C.views = C.views || {});

  /* ── Feature detection ── */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var TTS = window.speechSynthesis || null;
  var SUPPORTED = !!SR && !!TTS;

  /* ── Module-scoped voice runtime (persists across re-renders of this view) ── */
  var voice = {
    state: "idle",        // idle | listening | thinking | speaking | error
    recog: null,
    turns: [],            // [{ role:'user'|'assistant', content:string }]
    lastPartial: "",
    speakingUtter: null,
    booted: false
  };

  /* Keep the forwarded memory tiny: at most the last 6 messages (3 exchanges). */
  function memory() {
    return voice.turns.slice(-6).map(function (t) {
      return { role: t.role, content: t.content };
    });
  }

  /* ── Reasoning/thinking scrubber (client-side safety net) ──
   * The server already disables reasoning and strips <think> blocks, but this
   * guarantees the chain-of-thought is NEVER shown on screen NOR read aloud,
   * even for the degraded/typed paths or an unexpected upstream response.
   * Handles well-formed pairs, an unclosed opener (truncated mid-thought),
   * and a lone trailing close tag. */
  function stripThinking(input) {
    var s = typeof input === "string" ? input : "";
    // 1) Well-formed reasoning pairs.
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
    s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
    s = s.replace(/<thought>[\s\S]*?<\/thought>/gi, "");
    // 2) Unclosed opener → drop everything from it onward (nothing real follows).
    var openIdx = s.search(/<(?:think|reasoning|thought)\b[^>]*>/i);
    if (openIdx !== -1 && !/<\/(?:think|reasoning|thought)>/i.test(s.slice(openIdx))) {
      s = s.slice(0, openIdx);
    }
    // 3) Lone trailing close tag → keep only what follows the final one.
    var m, lastClose = -1, lastLen = 0;
    var re = /<\/(?:think|reasoning|thought)>/gi;
    while ((m = re.exec(s)) !== null) { lastClose = m.index; lastLen = m[0].length; }
    if (lastClose !== -1) s = s.slice(lastClose + lastLen);
    // 4) Scrub stray tags + collapse whitespace.
    s = s.replace(/<\/?(?:think|reasoning|thought)\b[^>]*>/gi, "");
    return s.replace(/\s+/g, " ").trim();
  }

  /* ── DOM helpers scoped to this view ── */
  function el(id) { return document.getElementById(id); }

  function setState(s) {
    voice.state = s;
    var orb = el("va-orb");
    var status = el("va-status");
    var micBtn = el("va-mic");
    var stopBtn = el("va-stop");
    if (orb) orb.setAttribute("data-state", s);
    if (status) {
      status.textContent =
        s === "listening" ? "Listening…" :
        s === "thinking" ? "Thinking…" :
        s === "speaking" ? "Speaking…" :
        s === "error" ? "Something went wrong" :
        "Tap the mic and ask a health question";
      status.setAttribute("data-state", s);
    }
    if (micBtn) {
      micBtn.classList.toggle("is-active", s === "listening");
      micBtn.disabled = (s === "thinking");
      micBtn.setAttribute("aria-pressed", s === "listening" ? "true" : "false");
    }
    if (stopBtn) stopBtn.hidden = (s !== "speaking");
  }

  function appendTurn(role, content) {
    voice.turns.push({ role: role, content: content });
    renderTranscript();
  }

  function renderTranscript() {
    var log = el("va-log");
    if (!log) return;
    if (!voice.turns.length) {
      log.innerHTML =
        '<p class="va-empty">Your conversation will appear here. ' +
        'Try: <span class="mono">"What helps a tension headache?"</span></p>';
      return;
    }
    log.innerHTML = voice.turns.map(function (t) {
      var who = t.role === "user" ? "You" : "Vaidyam";
      return '<div class="va-msg va-' + t.role + '">' +
        '<span class="va-who">' + who + '</span>' +
        '<p class="va-text">' + C.esc(t.content) + "</p></div>";
    }).join("");
    log.scrollTop = log.scrollHeight;
  }

  function setPartial(text) {
    var p = el("va-partial");
    if (p) p.textContent = text || "";
  }

  /* ── Text-to-Speech ── */
  function speak(text) {
    if (!TTS) { setState("idle"); return; }
    try { TTS.cancel(); } catch (e) {}
    var utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.02;
    utter.pitch = 1.0;
    utter.lang = "en-US";
    // Prefer a natural English voice when available.
    try {
      var voices = TTS.getVoices() || [];
      var pick = voices.filter(function (v) { return /en(-|_)?US/i.test(v.lang); })[0] ||
                 voices.filter(function (v) { return /^en/i.test(v.lang); })[0];
      if (pick) utter.voice = pick;
    } catch (e) {}
    voice.speakingUtter = utter;
    utter.onstart = function () { setState("speaking"); };
    utter.onend = function () { voice.speakingUtter = null; setState("idle"); };
    utter.onerror = function () { voice.speakingUtter = null; setState("idle"); };
    setState("speaking");
    TTS.speak(utter);
  }

  function stopSpeaking() {
    if (TTS) { try { TTS.cancel(); } catch (e) {} }
    voice.speakingUtter = null;
    setState("idle");
  }

  /* ── Reasoning: same-origin proxy → Groq ── */
  function ask(userText) {
    setState("thinking");
    appendTurn("user", userText);
    setPartial("");

    fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ message: userText, history: memory().slice(0, -1) })
    })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "Bad response" }; }); })
      .then(function (j) {
        if (j && j.ok && j.reply) {
          // Never surface or speak any reasoning/thinking that slipped through.
          var clean = stripThinking(j.reply);
          if (!clean) {
            clean = "I couldn't generate a clear answer just now. Please try rephrasing your health question. " +
                    "This is general info, not a substitute for professional medical advice.";
          }
          appendTurn("assistant", clean);
          if (j.usage) {
            var meta = el("va-usage");
            if (meta) meta.textContent = "tokens · in " + j.usage.in + " / out " + j.usage.out;
          }
          speak(clean);
        } else {
          var msg = (j && j.error) ? j.error : "I couldn't get a response. Please try again.";
          appendTurn("assistant", msg);
          speak(msg);
        }
      })
      .catch(function () {
        var msg = "I couldn't reach the assistant. Please check your connection and try again.";
        appendTurn("assistant", msg);
        speak(msg);
      });
  }

  /* ── Speech-to-Text ── */
  function startListening() {
    if (!SR) return;
    if (voice.state === "listening") { stopListening(); return; }
    if (TTS) { try { TTS.cancel(); } catch (e) {} }

    var recog = new SR();
    voice.recog = recog;
    recog.lang = "en-US";
    recog.interimResults = true;
    recog.continuous = false;
    recog.maxAlternatives = 1;
    voice.lastPartial = "";

    recog.onstart = function () { setState("listening"); setPartial(""); };
    recog.onresult = function (ev) {
      var interim = "";
      var finalText = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim) { voice.lastPartial = interim; setPartial(interim); }
      if (finalText) { voice.lastPartial = finalText; setPartial(finalText); }
    };
    recog.onerror = function (ev) {
      setPartial("");
      if (ev && ev.error === "not-allowed") {
        setState("error");
        C.toast("Microphone access was blocked. Allow it in your browser to talk.");
        setTimeout(function () { setState("idle"); }, 400);
      } else if (ev && ev.error === "no-speech") {
        C.toast("I didn't catch that — try again.");
        setState("idle");
      } else {
        setState("idle");
      }
    };
    recog.onend = function () {
      var text = (voice.lastPartial || "").trim();
      setPartial("");
      voice.recog = null;
      if (text && voice.state === "listening") {
        ask(text);
      } else if (voice.state === "listening") {
        setState("idle");
      }
    };

    try { recog.start(); }
    catch (e) { setState("idle"); }
  }

  function stopListening() {
    if (voice.recog) { try { voice.recog.stop(); } catch (e) {} }
  }

  /* ── Text fallback (accessibility + browsers without STT) ── */
  function submitTyped() {
    var input = el("va-type");
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    if (TTS) { try { TTS.cancel(); } catch (e) {} }
    ask(text);
  }

  /* ── View definition ── */
  V.assistant = {
    icon: "bi-mic",
    label: "AI Assistant",
    title: "Healthcare AI Assistant",
    skeleton: 3,
    /* No server data to preload — resolve immediately with an inert envelope. */
    load: function () {
      return Promise.resolve({ data: {}, provenance: [{ source: "Groq · qwen/qwen3.6-27b", live: !!C.state, detail: "voice assistant" }] });
    },
    render: function () {
      var head = C.viewHead(
        "Layer 2 · voice-to-voice",
        "Healthcare AI Assistant",
        "A browser-native, speak-and-listen health companion. Speech is transcribed on-device (Web Speech API), " +
        'reasoned by <span class="mono">qwen/qwen3.6-27b</span> on Groq Cloud, and spoken back to you. ' +
        "Answers are short, health-only, and for information — not a diagnosis."
      );

      var body = '<div class="bento">';

      /* Voice console */
      body += '<div class="c7" style="--i:0">' + C.card({
        title: "Talk to Vaidyam",
        note: "tap the mic, ask, and listen",
        icon: "bi-soundwave",
        body:
          '<div class="va-console">' +
            '<div id="va-orb" class="va-orb va-face-orb" data-state="idle" role="img" ' +
              'aria-label="Vaidyam assistant avatar">' +
              '<span class="va-ring"></span><span class="va-ring"></span><span class="va-ring"></span>' +
              // Pure CSS/HTML smiley-face avatar (replaces the microphone icon).
              // Facial expressions are driven entirely by the orb\'s data-state.
              '<span class="va-face" aria-hidden="true">' +
                '<span class="va-eyes">' +
                  '<span class="va-eye va-eye-l"><span class="va-pupil"></span></span>' +
                  '<span class="va-eye va-eye-r"><span class="va-pupil"></span></span>' +
                "</span>" +
                '<span class="va-mouth"></span>' +
              "</span>" +
            "</div>" +
            '<p id="va-status" class="va-status" data-state="idle" role="status" aria-live="polite">' +
              "Tap the mic and ask a health question</p>" +
            '<p id="va-partial" class="va-partial" aria-live="polite"></p>' +
            '<div class="va-controls">' +
              '<button type="button" id="va-mic" class="btn btn-primary va-mic" aria-pressed="false">' +
                '<i class="bi bi-mic-fill"></i> <span>Speak</span></button>' +
              '<button type="button" id="va-stop" class="btn btn-sm" hidden>' +
                '<i class="bi bi-stop-fill"></i> Stop</button>' +
            "</div>" +
            '<form id="va-form" class="va-typerow" autocomplete="off">' +
              '<input type="text" id="va-type" class="va-input" placeholder="…or type a health question" ' +
                'aria-label="Type a health question" />' +
              '<button type="submit" class="btn btn-sm"><i class="bi bi-send"></i></button>' +
            "</form>" +
            '<p id="va-usage" class="va-usage tiny"></p>' +
          "</div>"
      }) + "</div>";

      /* Transcript */
      body += '<div class="c5" style="--i:1">' + C.card({
        title: "Conversation",
        note: "kept short — only recent turns feed the model",
        icon: "bi-chat-dots",
        right: '<button type="button" id="va-clear" class="btn btn-sm"><i class="bi bi-eraser"></i> Clear</button>',
        body: '<div id="va-log" class="va-log"></div>'
      }) + "</div>";

      /* Guidance / disclaimer */
      body += '<div class="c12" style="--i:2">' + C.card({
        title: "How this works & safety",
        note: "browser-native STT + Groq reasoning + browser TTS",
        icon: "bi-shield-plus",
        body:
          '<div class="va-notes">' +
            '<div class="va-note"><i class="bi bi-1-circle"></i><div><b>Listen</b>' +
              "<p>Your voice is transcribed by your browser's Web Speech API.</p></div></div>" +
            '<div class="va-note"><i class="bi bi-2-circle"></i><div><b>Think</b>' +
              "<p>The text is sent to Groq Cloud (qwen/qwen3.6-27b) with a health-only, low-token prompt.</p></div></div>" +
            '<div class="va-note"><i class="bi bi-3-circle"></i><div><b>Speak</b>' +
              "<p>The reply is read aloud with your browser's speech synthesizer.</p></div></div>" +
          "</div>" +
          '<p class="va-disclaimer"><i class="bi bi-exclamation-triangle"></i> ' +
          "Vaidyam answers only health questions and provides general information — " +
          "it is not a substitute for professional medical advice, diagnosis, or treatment. " +
          "For emergencies, contact local emergency services.</p>" +
          (SUPPORTED ? "" :
            '<p class="va-disclaimer" style="margin-top:10px"><i class="bi bi-info-circle"></i> ' +
            "Your browser doesn't fully support voice input/output. You can still type your question above; " +
            "for the full voice experience use Chrome, Edge, or Safari.</p>")
      }) + "</div>";

      body += "</div>";
      return head + body;
    },

    /* Wire the console after each paint. Runtime state lives in `voice`. */
    after: function () {
      renderTranscript();
      setState(voice.speakingUtter ? "speaking" : (voice.state === "listening" ? "idle" : voice.state));
      // Reset a stale non-idle state on re-entry so the UI is never stuck.
      if (voice.state !== "speaking") setState("idle");

      var mic = el("va-mic");
      if (mic) {
        if (!SR) { mic.disabled = true; mic.title = "Voice input not supported in this browser"; }
        mic.addEventListener("click", startListening);
      }
      var stop = el("va-stop");
      if (stop) stop.addEventListener("click", stopSpeaking);

      var form = el("va-form");
      if (form) form.addEventListener("submit", function (e) { e.preventDefault(); submitTyped(); });

      var clear = el("va-clear");
      if (clear) clear.addEventListener("click", function () {
        voice.turns = [];
        stopSpeaking();
        renderTranscript();
        var u = el("va-usage"); if (u) u.textContent = "";
        C.toast("Conversation cleared");
      });

      // Warm up the voices list (Chrome populates it asynchronously).
      if (TTS && typeof TTS.getVoices === "function") {
        try { TTS.getVoices(); } catch (e) {}
        if (!voice.booted) {
          voice.booted = true;
          TTS.onvoiceschanged = function () { try { TTS.getVoices(); } catch (e) {} };
        }
      }
    }
  };
})();
