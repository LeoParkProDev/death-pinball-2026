'use client';

import React, { useState } from 'react';
import Lobby, { Player } from '@/components/Lobby';
import PinballBoard from '@/components/PinballBoard';

type GameState = 'lobby' | 'playing';

export default function Home() {
  const [gameState, setGameState] = useState<GameState>('lobby');
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameKey, setGameKey] = useState(0); // Key to force remount of PinballBoard

  const handleGameStart = (joinedPlayers: Player[]) => {
    setPlayers(joinedPlayers);
    setGameState('playing');
  };

  const handleRestart = () => {
    // Option 1: Go back to lobby
    // setGameState('lobby');
    // setPlayers([]);

    // Option 2: Restart immediately with same players
    setGameKey(prev => prev + 1);
  };

  return (
    <main className="min-h-screen bg-black">
      {gameState === 'lobby' ? (
        <Lobby onGameStart={handleGameStart} />
      ) : (
        <PinballBoard 
            key={gameKey} // Force remount on restart
            players={players} 
            onRestart={handleRestart} 
        />
      )}
    </main>
  );
}
