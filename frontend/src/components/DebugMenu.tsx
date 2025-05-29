// src/components/DebugMenu.tsx
import React from 'react';
import { Link } from 'react-router-dom';

const DebugMenu: React.FC = () => {
  return (
    <div>
      <h1>디버그 메뉴</h1>
      <ul>
        <li><Link to="/debug/prompt/1">prompt/1</Link></li>
        <li><Link to="/debug/prompt/2">prompt/2</Link></li>
        <li><Link to="/debug/prompt/3">prompt/3</Link></li>
        <li><Link to="/debug/prompt/4">prompt/4</Link></li>
        <li><Link to="/debug/prompt/5">prompt/5</Link></li>
        <li><Link to="/debug/prompt/6">prompt/6</Link></li>
        <li><Link to="/debug/prompt/7">prompt/7</Link></li>
        {/* 기타 API 링크 */}
        <li><Link to="/api/songs">song list</Link></li>
      </ul>
    </div>
  );
};

export default DebugMenu;
