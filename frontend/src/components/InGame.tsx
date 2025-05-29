import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GameScene } from '../scenes/GameScene';
import { useLocation, useNavigate } from 'react-router-dom';

export default function InGame() {
  const { songId, keyMode } = useLocation().state as any;
  const navigate = useNavigate();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const gameRef    = useRef<Phaser.Game>();

  /* 볼륨은 localStorage → state */
  const [volume, setVolume] = useState<number>(() => {
    const v = localStorage.getItem('rhythmGameVolume');
    return v ? Number(v) : 1;
  });
  const [showSettings, setShowSettings] = useState(false);

  /* ─────────────────────────────
     1) Phaser Game 부트
  ───────────────────────────── */
  useEffect(() => {
    /* 캔버스 초기화 */
    wrapperRef.current!.innerHTML = '';

    const game = new Phaser.Game({
      type : Phaser.AUTO,
      width: 360,
      height: 640,
      parent: wrapperRef.current!,
      scene : [GameScene],
      scale : { mode: Phaser.Scale.FIT }
    });
    gameRef.current = game;

    /* volume 을 포함해 데이터 전달 */
    game.scene.start('GameScene', { songId, keyMode, volume });

    return () => game.destroy(true);
  }, [songId, keyMode, volume]);

  /* ─────────────────────────────
     2) ESC → 선택 화면
  ───────────────────────────── */
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        gameRef.current?.destroy(true);
        navigate('/select');
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [navigate]);

  /* ─────────────────────────────
     3) P → 설정 / 일시정지
  ───────────────────────────── */
  useEffect(() => {
    const onP = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'p') {
        setShowSettings(show => {
          const next = !show;
          const scene = gameRef.current?.scene.getScene('GameScene');
          next ? scene?.scene.pause() : scene?.scene.resume();
          return next;
        });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onP);
    return () => window.removeEventListener('keydown', onP);
  }, []);

  /* ─────────────────────────────
     4) 볼륨 슬라이더
  ───────────────────────────── */
  const onVolumeChange = (v: number) => {
    setVolume(v);
    localStorage.setItem('rhythmGameVolume', String(v));
    /* GameScene 이 window 이벤트로 볼륨 변경 통지 받도록 */
    window.dispatchEvent(new CustomEvent('rg-set-volume', { detail: v }));
  };

  /* ─────────────────────────────
     5) 렌더
  ───────────────────────────── */
  const txt = 'text-gray-200';

  return (
    <div className="flex items-center justify-center w-full h-screen bg-black">
      <div className="w-[360px] h-[640px] bg-black rounded-lg overflow-hidden relative">

        {/* 게임 캔버스 */}
        <div ref={wrapperRef} className="w-full h-full" />

        {/* 설정 창 */}
        {showSettings && (
          <div className="absolute inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center p-4">
            <h3 className={`${txt} mb-2 text-lg`}>Sound Settings</h3>
            <div className="flex items-center space-x-2">
              <label className={txt}>Volume:</label>
              <input
                type="range" min={0} max={1} step={0.01}
                value={volume}
                onChange={e => onVolumeChange(Number(e.target.value))}
              />
              <span className={txt}>{Math.round(volume * 100)}%</span>
            </div>
            <button
              className="mt-4 px-4 py-2 bg-blue-400 text-black rounded"
              onClick={() => setShowSettings(false)}
            >
              Close&nbsp;(P)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
