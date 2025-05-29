// src/scenes/GameScene.ts
import Phaser from 'phaser';
import type { Chart, Note } from '../types/chart';

interface ActiveNote {
  note: Note;
  head: Phaser.GameObjects.Rectangle;
  body?: Phaser.GameObjects.Rectangle;
  judged: boolean;
  startJudged?: boolean;
  cancelled?: boolean;
}

export class GameScene extends Phaser.Scene {
  private songId!: string;
  private keyMode!: 4|5|6;
  private audio!: HTMLAudioElement;

  private chart!: Chart;
  private notes: ActiveNote[] = [];

  private speed = 1;
  private paused = false;
  private judgeY = 500;
  private pps = 200;

  private totalScore = 0;
  private totalNotes = 0;
  private judgedCount = 0;
  private scoreText!: Phaser.GameObjects.Text;

  private comboCount = 0;
  private comboTextTitle!: Phaser.GameObjects.Text;
  private comboTextCount!: Phaser.GameObjects.Text;

  private feedbackText!: Phaser.GameObjects.Text;
  private glowGraphics!: Phaser.GameObjects.Graphics;

  private keyMap: Record<4|5|6, number[]> = {
    4: [
      Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.D,
      Phaser.Input.Keyboard.KeyCodes.L,
      Phaser.Input.Keyboard.KeyCodes.SEMICOLON
    ],
    5: [
      Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.D,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.L,
      Phaser.Input.Keyboard.KeyCodes.SEMICOLON
    ],
    6: [
      Phaser.Input.Keyboard.KeyCodes.A,
      Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.D,
      Phaser.Input.Keyboard.KeyCodes.L,
      Phaser.Input.Keyboard.KeyCodes.SEMICOLON,
      Phaser.Input.Keyboard.KeyCodes.QUOTES
    ],
  };

  constructor() { super({ key: 'GameScene' }); }

  init(data: { songId: string; keyMode: 4|5|6; audio: HTMLAudioElement }) {
    this.songId  = data.songId;
    this.keyMode = data.keyMode;
    this.audio   = data.audio;
  }

  preload() {
    this.load.json(this.songId, `/api/chart/${this.songId}`);
  }

  create() {
    this.chart = this.cache.json.get(this.songId) as Chart;
    const chartForMode = this.chart[`${this.keyMode}key` as '4key'|'5key'|'6key'];
    this.totalNotes = chartForMode.chaebo.length;

    this.glowGraphics = this.add.graphics();
    this.drawColumns();

    // HUD: pastel-cyan score
    this.scoreText = this.add.text(10, 10, '0%', {
      fontSize: '16px', color: '#B2EBF2'
    }).setDepth(20);

    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;

    this.comboTextTitle = this.add.text(cx, cy - 20, 'Combo!', {
      fontSize: '32px', color: '#FFE4E1'
    }).setOrigin(0.5).setAlpha(0).setDepth(20);

    this.comboTextCount = this.add.text(cx, cy + 10, '', {
      fontSize: '24px', color: '#FFE4E1'
    })
      .setOrigin(0.5)
      .setStroke('#FFC0CB', 3)
      .setShadow(2, 2, '#000000', 2)
      .setAlpha(0)
      .setDepth(20);

    this.feedbackText = this.add.text(cx, this.judgeY - 50, '', {
      fontSize: '32px', align: 'center', color: '#E0FFFF'
    }).setOrigin(0.5).setDepth(20).setAlpha(0);

    // 노트 생성
    const colW = this.scale.width / this.keyMode;
    for (const note of chartForMode.chaebo) {
      const x = colW * (note.position - 0.5);
      const head = this.add.rectangle(x, 0, colW * 0.8, 20, 0xffffff).setOrigin(0.5);
      let body: Phaser.GameObjects.Rectangle|undefined;
      if (note.type === 'long') {
        body = this.add.rectangle(x, 0, colW * 0.4, 0, 0xffffff).setOrigin(0.5);
      }
      this.notes.push({ note, head, body, judged: false });
    }

    // 입력
    this.input.keyboard.on('keydown',   e => this.onKeyDown(e));
    this.input.keyboard.on('keyup',     e => this.onKeyUp(e));
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    this.input.keyboard.on('keydown-ONE',() => this.speed = Math.max(0.5, this.speed - 0.5));
    this.input.keyboard.on('keydown-TWO',() => this.speed += 0.5);
  }

  update() {
    if (this.paused) return;
    const elapsed = this.audio.currentTime;

    for (const an of this.notes) {
      const { note, head, body, judged, startJudged, cancelled } = an;
      const dS = note.time - elapsed;
      const y  = this.judgeY - dS * this.speed * this.pps;
      head.y = y;
      head.setVisible(y >= -50 && y <= this.scale.height + 50);

      if (body && note.type === 'long') {
        const dE = note.end! - elapsed;
        const y2 = this.judgeY - dE * this.speed * this.pps;
        body.y      = (y + y2) / 2;
        body.height = Math.max(5, y - y2);
      }

      if (note.type === 'short' && !judged && y > this.judgeY + 50) {
        this.judgeNote(an, Math.abs(dS), 'Miss', 0, 0xFF6B6B);
      }
      if (note.type === 'long' && !startJudged && !cancelled && y > this.judgeY + 50) {
        an.cancelled = true;
        this.tweens.add({ targets: head, alpha: 0, duration: 1000 });
        if (body) this.tweens.add({ targets: body, alpha: 0, duration: 1000 });
      }
      if (note.type === 'long' && startJudged && !judged && elapsed > note.end! + 0.8) {
        this.judgeNote(an, Math.abs(note.end! - elapsed), 'Miss', 0, 0xFF6B6B);
      }
    }

    this.notes = this.notes.filter(an => !an.judged && !an.cancelled);
  }

private onKeyDown(e: KeyboardEvent) {
  const idx = this.keyMap[this.keyMode].indexOf(e.keyCode);
  if (idx < 0) return;
  this.flashColumn(idx);

  const elapsed = this.audio.currentTime;
  let candidate: ActiveNote|null = null;
  let bestD = Infinity;
  for (const an of this.notes) {
    if (an.judged || an.note.position !== idx + 1) continue;
    const d = Math.abs(an.note.time - elapsed);
    if (d < bestD) { bestD = d; candidate = an; }
  }
  if (!candidate || bestD > 0.8) return;

  if (candidate.note.type === 'short') {
    // 숏 노트는 기존대로
    const sc  = bestD < 0.1 ? 100 : bestD <= 0.5 ? 50 : 0;
    const msg = bestD < 0.1 ? 'Perfect!' : 'Fast';
    this.judgeNote(candidate, bestD, msg, sc, 0xA8E6CF);

  } else {
    // ─── 롱노트 시작: Hold! 표시만, 파괴 NO
    candidate.startJudged = true;
    // this.feedbackText
    //   .setText('Hold!')
    //   .setColor('#A8E6CF')
    //   .setAlpha(1);
    this.tweens.add({
      targets: this.feedbackText,
      alpha: 0,
      delay: 300,
      duration: 200
    });

    // ─── 남은 길이에 맞춰 부드러운 페이드아웃
    const remainingSec = candidate.note.end! - elapsed;
    const durationMs   = Math.max(0, remainingSec * 1000 / this.speed);
    this.tweens.add({
      targets: [candidate.head, candidate.body].filter(x => !!x),
      alpha: { from: 1, to: 0 },
      duration: durationMs,
      ease: 'Linear'
    });
    // **이제 onKeyUp에서만 judgeNote** 호출하도록 변경됩니다.
  }
}

  private onKeyUp(e: KeyboardEvent) {
    const idx = this.keyMap[this.keyMode].indexOf(e.keyCode);
    if (idx < 0) return;
    const elapsed = this.audio.currentTime;
    let cand: ActiveNote|null = null, best = Infinity;
    for (const an of this.notes) {
      if (an.note.type !== 'long' || !an.startJudged || an.judged) continue;
      if (an.note.position !== idx+1) continue;
      const d = Math.abs(an.note.end! - elapsed);
      if (d < best) { best = d; cand = an; }
    }
    if (!cand) return;

    if (best > 0.8) {
      this.judgeNote(cand, best, 'Miss', 0, 0xFF6B6B);
    } else {
      const perf = best < 0.1;
      const sc = perf
        ? 100
        : Math.round(Phaser.Math.Linear(99, 50, (best - 0.1) / 0.4));
      const msg = perf ? 'Perfect!' : 'Slow';
      this.judgeNote(cand, best, msg, sc, 0xA8E6CF);
    }
  }

  private judgeNote(
    an: ActiveNote,
    _d: number,
    msg: string,
    score: number,
    color: number
  ) {
    an.judged = true;
    an.head.destroy();
    if (an.body) an.body.destroy();

    this.feedbackText
      .setText(msg)
      .setColor(`#${color.toString(16).padStart(6,'0')}`)
      .setAlpha(1);
    this.tweens.add({ targets: this.feedbackText, alpha: 0, delay: 500, duration: 300 });

    this.totalScore += score;
    this.judgedCount++;
    const pct = this.totalNotes > 0
      ? Math.round((this.totalScore / (this.judgedCount * 100)) * 100)
      : 0;
    this.scoreText.setText(`${pct}%`);

    this.comboCount = score > 0 ? this.comboCount + 1 : 0;
    if (this.comboCount > 1) {
      this.comboTextTitle.setAlpha(1);
      this.comboTextCount.setText(String(this.comboCount)).setAlpha(1);
    } else {
      this.comboTextTitle.setAlpha(0);
      this.comboTextCount.setAlpha(0);
    }
  }

  private drawColumns() {
    const g = this.add.graphics();
    const w = this.scale.width, h = this.scale.height, colW = w / this.keyMode;
    g.lineStyle(1, 0xcccccc, 0.3);
    for (let i = 1; i < this.keyMode; i++) {
      const x = colW * i;
      g.moveTo(x, 0); g.lineTo(x, h);
    }
    g.lineStyle(4, 0xffffff);
    g.moveTo(0, this.judgeY); g.lineTo(w, this.judgeY);
    g.strokePath();
  }

  private flashColumn(idx: number) {
    const colW = this.scale.width / this.keyMode, x0 = colW * idx;
    const blue = 0x8ecae6;
    let hl = 0xffffff;
    if ((this.keyMode === 4 && (idx===1||idx===2)) || (this.keyMode!==4 && (idx+1)%2===0)) hl = blue;

    this.glowGraphics.clear();
    this.glowGraphics.fillGradientStyle(0x000000,0x000000,hl,hl,0.7);
    this.glowGraphics.fillRect(x0,0,colW,this.judgeY);
    this.time.delayedCall(300,() => this.glowGraphics.clear());
  }

  private togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.scene.pause();
      this.audio.pause();
    } else {
      this.scene.resume();
      this.audio.play();
    }
  }
}
