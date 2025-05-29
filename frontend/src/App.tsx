// src/App.tsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainMenu from './components/MainMenu.tsx';
import SongSelect from './components/SongSelect.tsx';
import InGame from './components/InGame.tsx';
import DebugMenu from './components/DebugMenu';
import DebugPrompt from './components/DebugPrompt'; // DebugPrompt 컴포넌트 임포트
import { GameScene } from './scenes/GameScene';

const GameContainer: React.FC = () => {
  const gameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (gameRef.current) {
      new Phaser.Game({
        type: Phaser.AUTO,
        width: 800,
        height: 600,
        parent: gameRef.current,
        scene: [GameScene]
      });
    }
  }, []);

  return <div ref={gameRef} className="w-full h-screen" />;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainMenu />} />
        <Route path="/select" element={<SongSelect />} />
        <Route path="/play" element={<InGame />} />
        <Route path="/debug" element={<DebugMenu />} />
        <Route path="/debug/prompt/:prompt_id" element={<DebugPrompt />} /> {/* DebugPrompt 경로 추가 */}
      </Routes>
    </BrowserRouter>
  );
};

export default App;
