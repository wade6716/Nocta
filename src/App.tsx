import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { TitleBar } from './components/layout/TitleBar';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { DetailPage } from './pages/DetailPage';
import { PlayerPage } from './pages/PlayerPage';
import { ErrorBoundary } from './components/common/ErrorBoundary';

export const App: React.FC = () => {
  const location = useLocation();
  const isPlayerPage = location.pathname.startsWith('/player');

  return (
    <ErrorBoundary fallbackTitle="应用发生意外错误">
      <div className="h-screen w-screen bg-background select-none overflow-hidden flex flex-col">
        {/* Native-style TitleBar for non-player routes */}
        {!isPlayerPage && <TitleBar title="Emby Player" />}

        {/* Main view container with vertical scroll */}
        <main
          id="main-scroll-container"
          className={`flex-1 min-h-0 w-full ${
            isPlayerPage ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'
          }`}
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/detail/:itemId" element={<DetailPage />} />
            <Route path="/player/:itemId" element={<PlayerPage />} />
          </Routes>
        </main>
      </div>
    </ErrorBoundary>
  );
};

export default App;
