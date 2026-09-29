/* =========================================================
   Text-to-Speech Audiobook — app.js
   Vanilla JS only. Uses the browser Web Speech API.
   No network requests, no storage, no frameworks.
   ========================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     Element references (every id below exists in index.html)
     --------------------------------------------------------- */
  var el = {
    unsupportedBanner: document.getElementById('unsupportedBanner'),
    textInput: document.getElementById('textInput'),
    charCount: document.getElementById('charCount'),
    clearBtn: document.getElementById('clearBtn'),
    sampleEnBtn: document.getElementById('sampleEnBtn'),
    sampleHiBtn: document.getElementById('sampleHiBtn'),
    languageSelect: document.getElementById('languageSelect'),
    voiceSelect: document.getElementById('voiceSelect'),
    voiceInfo: document.getElementById('voiceInfo'),
    voiceWarning: document.getElementById('voiceWarning'),
    statusChip: document.getElementById('statusChip'),
    statusText: document.getElementById('statusText'),
    playBtn: document.getElementById('playBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    stopBtn: document.getElementById('stopBtn'),
    rateRange: document.getElementById('rateRange'),
    rateValue: document.getElementById('rateValue'),
    errorMessage: document.getElementById('errorMessage')
  };

  /* ---------------------------------------------------------
     Feature detection
     --------------------------------------------------------- */
  var synth = window.speechSynthesis;
  var hasSpeech = !!(
    synth &&
    typeof window.SpeechSynthesisUtterance === 'function' &&
    typeof synth.speak === 'function'
  );

  /* ---------------------------------------------------------
     Constants & state
     --------------------------------------------------------- */
  var SAMPLES = {
    en: 'Welcome to your personal audiobook. This player uses the voices that are already built into your device, so nothing is uploaded and nothing is downloaded. Paste any English text you like, choose a voice, and press Play. You can slow the reading down or speed it up whenever you like.',
    hi: 'नमस्ते! यह आपकी निजी ऑडियोबुक है। यह प्लेयर आपके डिवाइस में पहले से मौजूद आवाज़ों का उपयोग करता है, इसलिए कुछ भी अपलोड या डाउनलोड नहीं होता। कोई भी हिंदी पाठ यहाँ चिपकाइए, आवाज़ चुनिए और प्ले दबाइए।',
  };

  var MAX_CHUNK_LENGTH = 220;

  var STATE_LABEL = {
    ready: 'Ready',
    speaking: 'Speaking',
    paused: 'Paused',
    finished: 'Finished'
  };

  var voices = [];
  var selectedVoiceURI = '';
  var playState = 'ready';
  var sessionId = 0;
  var voicesReady = false;

  /* ---------------------------------------------------------
     Small helpers
     --------------------------------------------------------- */

  function disableNode(node) {
    if (node) node.disabled = true;
  }

  function clampRate(value) {
    var num = parseFloat(value);
    if (isNaN(num)) return 1;
    if (num < 0.7) return 0.7;
    if (num > 1.3) return 1.3;
    return num;
  }

  function langToCode(lang) {
    return lang === 'hi' ? 'hi-IN' : 'en-US';
  }

  function langLabel(lang) {
    return lang === 'hi' ? 'Hindi' : 'English';
  }

  function prettyLang(code) {
    if (!code) return 'unknown language';
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
        var names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' });
        var label = names.of(code);
        if (label) return label + ' (' + code + ')';
      }
    } catch (err) {
      /* ignore and fall through to the raw code */
    }
    return code;
  }

  /* ---------------------------------------------------------
     Status, error and warning UI
     --------------------------------------------------------- */

  function setStatus(next) {
    playState = next;
    el.statusText.textContent = STATE_LABEL[next] || 'Ready';
    el.statusChip.classList.remove('is-speaking', 'is-paused', 'is-finished');
    if (next === 'speaking') el.statusChip.classList.add('is-speaking');
    else if (next === 'paused') el.statusChip.classList.add('is-paused');
    else if (next === 'finished') el.statusChip.classList.add('is-finished');
  }

  function showError(message) {
    el.errorMessage.textContent = message;
    el.errorMessage.hidden = false;
  }

  function clearError() {
    el.errorMessage.textContent = '';
    el.errorMessage.hidden = true;
  }

  function showVoiceWarning(message) {
    el.voiceWarning.textContent = message;
    el.voiceWarning.hidden = false;
  }

  function clearVoiceWarning() {
    el.voiceWarning.textContent = '';
    el.voiceWarning.hidden = true;
  }

  /* ---------------------------------------------------------
     Character count
     --------------------------------------------------------- */

  function updateCharCount() {
    var count = el.textInput.value.length;
    el.charCount.textContent =
      count.toLocaleString() + (count === 1 ? ' character' : ' characters');
  }

  /* ---------------------------------------------------------
     Language detection and matching
     --------------------------------------------------------- */

  function detectLang(text) {
    return /[\u0900-\u097F]/.test(text) ? 'hi' : 'en';
  }

  function requestedLang() {
    var pref = el.languageSelect.value;
    if (pref === 'en' || pref === 'hi') return pref;
    return detectLang(el.textInput.value);
  }

  function voiceMatchesLang(voice, lang) {
    var code = String(voice.lang || '').toLowerCase().replace('_', '-');
    return code === lang || code.indexOf(lang + '-') === 0;
  }

  /* ---------------------------------------------------------
     Voice list
     --------------------------------------------------------- */

  function getSelectedVoice() {
    var uri = el.voiceSelect.value;
    if (!uri) return null;
    for (var i = 0; i < voices.length; i += 1) {
      if (voices[i].voiceURI === uri) return voices[i];
    }
    return null;
  }

  function refreshVoices() {
    if (!hasSpeech) return;
    var list = synth.getVoices();
    if (!list || !list.length) return;

    voices = list.slice();
    voicesReady = true;
    populateVoiceSelect();
  }

  function populateVoiceSelect() {
    var pref = el.languageSelect.value;
    var list = voices.slice();

    if (pref === 'en' || pref === 'hi') {
      list = list.filter(function (voice) {
        return voiceMatchesLang(voice, pref);
      });
    }

    list.sort(function (a, b) {
      return (
        String(a.lang).localeCompare(String(b.lang)) ||
        String(a.name).localeCompare(String(b.name))
      );
    });

    el.voiceSelect.textContent = '';

    if (!list.length) {
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'No voice available';
      el.voiceSelect.appendChild(placeholder);
      el.voiceSelect.disabled = true;
      el.voiceInfo.textContent = '';

      if (pref === 'hi') {
        showVoiceWarning(
          'No Hindi voice is installed on this device, so Hindi speech is not available right now. ' +
          'On iPhone you can add one in Settings \u2192 Accessibility \u2192 Spoken Content \u2192 Voices \u2192 Hindi, ' +
          'then reload this page.'
        );
      } else if (pref === 'en') {
        showVoiceWarning(
          'No English voice is available on this device. Try the Auto option to see every installed voice.'
        );
      } else {
        showVoiceWarning(
          'No speech voices are available in this browser yet. Try reloading the page, or check your device voice settings.'
        );
      }
      return;
    }

    var keep = selectedVoiceURI;
    var stillExists = list.some(function (voice) {
      return voice.voiceURI === keep;
    });

    if (!keep || !stillExists) {
      var wanted = requestedLang();
      var match = list.find(function (voice) {
        return voiceMatchesLang(voice, wanted);
      });
      keep = (match || list[0]).voiceURI;
    }

    selectedVoiceURI = keep;

    list.forEach(function (voice) {
      var option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = voice.name + ' \u2014 ' + prettyLang(voice.lang);
      el.voiceSelect.appendChild(option);
    });

    el.voiceSelect.disabled = false;
    el.voiceSelect.value = selectedVoiceURI;

    updateVoiceInfo();
  }

  function updateVoiceInfo() {
    var voice = getSelectedVoice();

    if (!voice) {
      el.voiceInfo.textContent = 'No voice selected.';
      return;
    }

    el.voiceInfo.textContent = 'Using: ' + voice.name + ' \u00B7 ' + prettyLang(voice.lang);

    var wanted = requestedLang();

    if (!voiceMatchesLang(voice, wanted)) {
      showVoiceWarning(
        'A ' + langLabel(wanted) + ' voice is not available on this device, so "' + voice.name +
        '" will read the text instead. Pronunciation may be inaccurate. On iPhone you can add voices in ' +
        'Settings \u2192 Accessibility \u2192 Spoken Content \u2192 Voices.'
      );
    } else {
      clearVoiceWarning();
    }
  }

  /* ---------------------------------------------------------
     Text chunking
     Long utterances can be cut off by some engines, so the
     text is split into sentence-sized pieces and queued.
     --------------------------------------------------------- */

  function splitIntoChunks(text, maxLen) {
    var limit = maxLen || MAX_CHUNK_LENGTH;
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];

    var sentences = clean.match(/[^.!?\u0964\u0965]+[.!?\u0964\u0965]*/g) || [clean];
    var chunks = [];
    var buffer = '';

    function flush() {
      var value = buffer.trim();
      if (value) chunks.push(value);
      buffer = '';
    }

    sentences.forEach(function (raw) {
      var sentence = raw.trim();
      if (!sentence) return;

      while (sentence.length > limit) {
        flush();
        chunks.push(sentence.slice(0, limit).trim());
        sentence = sentence.slice(limit).trim();
      }

      if (!sentence) return;

      if (!buffer) {
        buffer = sentence;
      } else if (buffer.length + 1 + sentence.length <= limit) {
        buffer += ' ' + sentence;
      } else {
        flush();
        buffer = sentence;
      }
    });

    flush();
    return chunks;
  }

  /* ---------------------------------------------------------
     Playback
     --------------------------------------------------------- */

  function startSpeaking() {
    if (!hasSpeech) {
      showError('Speech synthesis is not supported in this browser.');
      return;
    }

    clearError();

    var text = el.textInput.value.trim();
    if (!text) {
      showError('Please enter or paste some text first.');
      return;
    }

    var chunks = splitIntoChunks(text, MAX_CHUNK_LENGTH);
    if (!chunks.length) {
      showError('Please enter or paste some text first.');
      return;
    }

    var voice = getSelectedVoice();
    var lang = voice ? voice.lang : langToCode(requestedLang());
    var rate = clampRate(el.rateRange.value);

    sessionId += 1;
    var mySession = sessionId;

    var wasActive = !!(synth.speaking || synth.pending || synth.paused);

    if (wasActive) {
      synth.cancel();
      if (synth.paused && typeof synth.resume === 'function') {
        synth.resume();
      }
    }

    function queueSpeech() {
      if (mySession !== sessionId) return;

      chunks.forEach(function (chunk, index) {
        var utterance = new SpeechSynthesisUtterance(chunk);

        if (voice) utterance.voice = voice;
        utterance.lang = lang || 'en-US';
        utterance.rate = rate;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onstart = function () {
          if (mySession !== sessionId) return;
          setStatus('speaking');
        };

        utterance.onend = function () {
          if (mySession !== sessionId) return;
          if (index === chunks.length - 1) {
            setStatus('finished');
          }
        };

        utterance.onerror = function (event) {
          if (mySession !== sessionId) return;

          var code = event && event.error ? event.error : 'unknown';

          if (code === 'interrupted' || code === 'canceled') return;

          if (code === 'not-allowed') {
            showError('The browser blocked speech. Tap the Play button once more to allow audio playback.');
          } else if (code === 'voice-unavailable') {
            showError('That voice is not available on this device. Please choose another voice.');
          } else {
            showError('Speech could not be played (' + code + ').');
          }

          setStatus('ready');
        };

        synth.speak(utterance);
      });

      setStatus('speaking');
    }

    if (wasActive) {
      // Give the engine a moment after cancel(); some browsers ignore an
      // immediate speak() that follows a cancel().
      window.setTimeout(queueSpeech, 60);
    } else {
      queueSpeech();
    }
  }

  function pauseSpeaking() {
    if (!hasSpeech) return;
    clearError();

    if (!synth.speaking) {
      showError('Nothing is playing right now.');
      return;
    }

    if (playState === 'paused') return;

    synth.pause();
    setStatus('paused');

    window.setTimeout(function () {
      if (playState === 'paused' && synth.speaking && !synth.paused) {
        showError('This browser did not pause the speech. Use Stop to end playback instead.');
      }
    }, 300);
  }

  function resumeSpeaking() {
    if (!hasSpeech) return;
    clearError();

    if (!synth.paused) {
      showError('Speech is not paused.');
      return;
    }

    synth.resume();
    setStatus('speaking');
  }

  function stopSpeaking() {
    if (!hasSpeech) return;

    sessionId += 1;
    synth.cancel();

    // Some engines stay stuck in a paused state after cancel().
    if (typeof synth.resume === 'function' && synth.paused) {
      synth.resume();
    }

    setStatus('ready');
    clearError();
  }

  /* ---------------------------------------------------------
     Rate label
     --------------------------------------------------------- */

  function updateRateLabel() {
    var value = clampRate(el.rateRange.value);
    el.rateValue.textContent = value.toFixed(1) + '\u00D7';
  }

  /* ---------------------------------------------------------
     Sample text
     --------------------------------------------------------- */

  function loadSample(lang) {
    el.textInput.value = SAMPLES[lang] || '';
    updateCharCount();
    clearError();
    if (voicesReady) updateVoiceInfo();
  }

  /* ---------------------------------------------------------
     Initialisation
     --------------------------------------------------------- */

  function init() {
    updateCharCount();
    updateRateLabel();
    setStatus('ready');

    if (!hasSpeech) {
      el.unsupportedBanner.hidden = false;
      el.voiceInfo.textContent = 'Voice list unavailable.';
      disableNode(el.playBtn);
      disableNode(el.pauseBtn);
      disableNode(el.resumeBtn);
      disableNode(el.stopBtn);
      disableNode(el.voiceSelect);
      disableNode(el.languageSelect);
      showError('Speech synthesis is not supported in this browser.');
      return;
    }

    /* ---- text input ---- */
    el.textInput.addEventListener('input', function () {
      updateCharCount();
      if (voicesReady) updateVoiceInfo();
    });

    el.clearBtn.addEventListener('click', function () {
      el.textInput.value = '';
      updateCharCount();
      clearError();
      if (voicesReady) updateVoiceInfo();
    });

    el.sampleEnBtn.addEventListener('click', function () {
      loadSample('en');
    });

    el.sampleHiBtn.addEventListener('click', function () {
      loadSample('hi');
    });

    /* ---- language & voice ---- */
    el.languageSelect.addEventListener('change', function () {
      selectedVoiceURI = '';
      clearError();
      if (voicesReady) populateVoiceSelect();
    });

    el.voiceSelect.addEventListener('change', function () {
      selectedVoiceURI = el.voiceSelect.value;
      clearError();
      updateVoiceInfo();
    });

    /* ---- playback controls ---- */
    el.playBtn.addEventListener('click', function () {
      if (playState === 'paused' && synth.paused) {
        resumeSpeaking();
        return;
      }
      startSpeaking();
    });

    el.pauseBtn.addEventListener('click', pauseSpeaking);
    el.resumeBtn.addEventListener('click', resumeSpeaking);
    el.stopBtn.addEventListener('click', stopSpeaking);

    el.rateRange.addEventListener('input', updateRateLabel);

    /* ---- voice loading ---- */
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', refreshVoices);
    } else {
      synth.onvoiceschanged = refreshVoices;
    }

    refreshVoices();

    // Some browsers (notably iOS Safari) only expose the full voice list
    // after a short delay or the first user interaction. Poll briefly and
    // re-check on the first touch/click.
    var tries = 0;
    var poll = window.setInterval(function () {
      tries += 1;
      refreshVoices();
      if (voicesReady || tries > 10) window.clearInterval(poll);
    }, 400);

    function nudgeVoices() {
      document.removeEventListener('touchstart', nudgeVoices);
      document.removeEventListener('click', nudgeVoices);
      window.setTimeout(refreshVoices, 0);
    }

    document.addEventListener('touchstart', nudgeVoices, { passive: true });
    document.addEventListener('click', nudgeVoices);

    /* ---- cleanup ---- */
    window.addEventListener('pagehide', function () {
      if (hasSpeech) synth.cancel();
    });
  }

  init();
})();