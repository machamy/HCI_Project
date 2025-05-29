// src/components/MainMenu.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';

const MainMenu: React.FC = () => {
  const navigate = useNavigate();

  React.useEffect(() => {
    const onKeyDown = () => navigate('/select');
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return (
    // 전체 화면 중앙 정렬
    <div className="flex items-center justify-center w-full h-screen bg-gray-100">
      {/* 고정 해상도 박스 */}
      <div className="w-[360px] h-[640px] bg-white rounded-lg shadow-lg flex flex-col items-center justify-center">
        <h1 className="text-4xl font-bold mb-4">Rhythm Game</h1>
        <p className="text-lg text-gray-600">Press any key to start</p>
      </div>
    </div>
  );
};

export default MainMenu;
