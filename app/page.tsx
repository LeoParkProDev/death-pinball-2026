'use client';

import React, { useState } from 'react';
import Lobby, { Player } from '@/components/Lobby';
import PinballBoard from '@/components/PinballBoard';

type GameState = 'lobby' | 'playing';

export default function Home() {
  const [gameState, setGameState] = useState<GameState>('lobby');
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameKey, setGameKey] = useState(0); 
  const [currentRoomId, setCurrentRoomId] = useState<string>('');

  const handleGameStart = (joinedPlayers: Player[], roomId: string) => {
    setPlayers(joinedPlayers);
    setCurrentRoomId(roomId);
    setGameState('playing');
  };

  const handleRestart = () => {
    setGameKey(prev => prev + 1);
  };

  return (
    <main className="min-h-screen bg-black">
      {gameState === 'lobby' ? (
        <Lobby onGameStart={handleGameStart} />
      ) : (
        <PinballBoard 
            key={gameKey} 
            players={players} 
            onRestart={handleRestart}
            roomId={currentRoomId}
        />
      )}
    </main>
  );
}
