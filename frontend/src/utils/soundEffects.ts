class SoundEffects {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _volume: number = 0.5; // default volume 50%

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Resume context if suspended (browser security autoplays)
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private getDestination(ctx: AudioContext): AudioNode {
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(this._volume, ctx.currentTime);
      this.masterGain.connect(ctx.destination);
    }
    return this.masterGain;
  }

  setVolume(vol: number) {
    this._volume = vol;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setValueAtTime(vol, this.ctx.currentTime);
    }
  }

  getVolume() {
    return this._volume;
  }

  playClick() {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

      osc.connect(gain);
      gain.connect(this.getDestination(ctx));

      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.warn("Audio blocked or unsupported:", e);
    }
  }

  playCardDeal() {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(this.getDestination(ctx));

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
      console.warn("Audio blocked or unsupported:", e);
    }
  }

  playShimmer() {
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;
      
      // Clean high-pitched arpeggio
      const freqs = [880, 1100, 1320, 1760];
      freqs.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = freq;

        const start = now + index * 0.04;
        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.04, start);
        gain.gain.exponentialRampToValueAtTime(0.0005, start + 0.18);

        osc.connect(gain);
        gain.connect(this.getDestination(ctx));

        osc.start(start);
        osc.stop(start + 0.18);
      });
    } catch (e) {
      console.warn("Audio blocked or unsupported:", e);
    }
  }

  playVictory() {
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;

      // Bright arpeggio: C5 -> E5 -> G5 -> C6
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = freq;

        const start = now + index * 0.1;
        const duration = index === notes.length - 1 ? 0.5 : 0.2;

        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.08, start);
        gain.gain.exponentialRampToValueAtTime(0.0005, start + duration);

        osc.connect(gain);
        gain.connect(this.getDestination(ctx));

        osc.start(start);
        osc.stop(start + duration);
      });
    } catch (e) {
      console.warn("Audio blocked or unsupported:", e);
    }
  }

  playWoodThud() {
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;
      const duration = 0.15;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + duration);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.getDestination(ctx));

      const bufferSize = ctx.sampleRate * 0.05;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(250, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.12, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.getDestination(ctx));

      osc.start(now);
      osc.stop(now + duration);
      noise.start(now);
      noise.stop(now + 0.05);
    } catch (e) {
      console.warn("Audio blocked or unsupported:", e);
    }
  }

  playCardSnap() {
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = "triangle";
      osc.frequency.setValueAtTime(380, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.getDestination(ctx));

      const bufferSize = ctx.sampleRate * 0.02;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(800, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.15, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.getDestination(ctx));

      osc.start(now);
      osc.stop(now + 0.08);
      noise.start(now);
      noise.stop(now + 0.02);
    } catch (e) {
      console.warn("Audio blocked or unsupported:", e);
    }
  }

  playSwordSlash() {
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;
      const duration = 0.35;

      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(3200, now + 0.2);
      filter.Q.value = 2.0;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.04, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.getDestination(ctx));

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();

      osc1.type = "sine";
      osc1.frequency.value = 2800;

      osc2.type = "sine";
      osc2.frequency.value = 4200;

      const ringGain = ctx.createGain();
      ringGain.gain.setValueAtTime(0.02, now + 0.05);
      ringGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc1.connect(ringGain);
      osc2.connect(ringGain);
      ringGain.connect(this.getDestination(ctx));

      noise.start(now);
      noise.stop(now + duration);
      osc1.start(now + 0.05);
      osc1.stop(now + duration);
      osc2.start(now + 0.05);
      osc2.stop(now + duration);
    } catch (e) {
      console.warn("Audio blocked or unsupported:", e);
    }
  }

  playMultipleSwords() {
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;
      
      const playSingleSlash = (delay: number, basePitch: number) => {
        const start = now + delay;
        const duration = 0.32;

        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(1000, start);
        filter.frequency.exponentialRampToValueAtTime(2800, start + 0.18);
        filter.Q.value = 2.0;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.03, start);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.getDestination(ctx));

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const ringGain = ctx.createGain();

        osc1.type = "sine";
        osc1.frequency.value = basePitch;

        osc2.type = "sine";
        osc2.frequency.value = basePitch * 1.5;

        ringGain.gain.setValueAtTime(0.015, start + 0.04);
        ringGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc1.connect(ringGain);
        osc2.connect(ringGain);
        ringGain.connect(this.getDestination(ctx));

        noise.start(start);
        noise.stop(start + duration);
        osc1.start(start + 0.04);
        osc1.stop(start + duration);
        osc2.start(start + 0.04);
        osc2.stop(start + duration);
      };

      playSingleSlash(0, 2600);
      playSingleSlash(0.06, 3100);
    } catch (e) {
      console.warn("Audio blocked or unsupported:", e);
    }
  }

  playCoinsClink() {
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;

      const playClink = (delay: number, baseFreq: number) => {
        const start = now + delay;
        const duration = 0.08;

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        const gain2 = ctx.createGain();

        osc1.type = "sine";
        osc1.frequency.setValueAtTime(baseFreq, start);
        osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.96, start + duration);

        osc2.type = "sine";
        osc2.frequency.setValueAtTime(baseFreq * 1.53, start);

        gain1.gain.setValueAtTime(0.03, start);
        gain1.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        gain2.gain.setValueAtTime(0.015, start);
        gain2.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc1.connect(gain1);
        gain1.connect(this.getDestination(ctx));

        osc2.connect(gain2);
        gain2.connect(this.getDestination(ctx));

        osc1.start(start);
        osc1.stop(start + duration);
        osc2.start(start);
        osc2.stop(start + duration);

        const bufferSize = ctx.sampleRate * 0.015;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.setValueAtTime(4500, start);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.02, start);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.015);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.getDestination(ctx));

        noise.start(start);
        noise.stop(start + 0.015);
      };

      playClink(0, 3600);
      playClink(0.02, 4200);
      playClink(0.05, 3100);
      playClink(0.09, 3900);
    } catch (e) {
      console.warn("Audio blocked or unsupported:", e);
    }
  }

  playCard(card: string) {
    if (!card) return;
    if (card === "1-espada") {
      this.playSwordSlash();
    } else if (card === "1-basto") {
      this.playWoodThud();
    } else if (card === "7-espada") {
      this.playMultipleSwords();
    } else if (card === "7-oro") {
      this.playCoinsClink();
    } else {
      this.playCardSnap();
    }
  }
}

export const soundEffects = new SoundEffects();
