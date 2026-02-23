'use client';

import React, { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { supabase } from '@/lib/supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import seedrandom from 'seedrandom';

export type Player = {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isHost: boolean;
  isReady: boolean;
};

interface PinballBoardProps {
  players: Player[];
  roomId: string;
  randomSeed: string;
  isHost: boolean;
  onRestart: () => void;
}

const PinballBoard: React.FC<PinballBoardProps> = ({ players, roomId, randomSeed, isHost, onRestart }) => {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  
  const [winner, setWinner] = useState<Player | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // --- Realtime Winner Sync ---
  useEffect(() => {
      if (!roomId) return;

      const channel = supabase.channel(`room:${roomId}`, {
        config: { broadcast: { self: true } }
      });

      channel
        .on('broadcast', { event: 'game_winner' }, ({ payload }) => {
            // Received winner from Host
            if (payload.winnerId) {
                const winnerPlayer = players.find(p => p.id === payload.winnerId);
                if (winnerPlayer) {
                    setWinner(winnerPlayer);
                    if (runnerRef.current) Matter.Runner.stop(runnerRef.current);
                }
            }
        })
        .on('broadcast', { event: 'restart_game' }, () => {
            onRestart();
        })
        .subscribe();

      channelRef.current = channel;

      return () => {
          supabase.removeChannel(channel);
      };
  }, [roomId, players]);


  // --- Physics Engine ---
  useEffect(() => {
    if (!sceneRef.current || players.length === 0) return;
    if (winner) return; 

    // Initialize RNG with seed
    const rng = seedrandom(randomSeed);

    // 1. Setup Matter.js
    const Engine = Matter.Engine;
    const Render = Matter.Render;
    const Runner = Matter.Runner;
    const World = Matter.World;
    const Bodies = Matter.Bodies;
    const Events = Matter.Events;

    // Deterministic simulation is hard in JS, but seed helps initial state
    const engine = Engine.create();
    const world = engine.world;
    
    engine.gravity.y = 0.17;
    engineRef.current = engine;

    const width = 600;
    const height = 800;

    const render = Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width,
        height,
        wireframes: false,
        background: '#1a1a1a',
      },
    });
    renderRef.current = render;

    // 2. Walls & Dividers
    const wallOptions = { isStatic: true, render: { fillStyle: '#555' } };
    const leftWall = Bodies.rectangle(10, height / 2, 20, height, wallOptions);
    const rightWall = Bodies.rectangle(width - 10, height / 2, 20, height, wallOptions);
    
    // Bottom dividers
    const dividerHeight = 100;
    const dividerY = height - dividerHeight / 2;
    const divider1 = Bodies.rectangle(150, dividerY, 10, dividerHeight, wallOptions);
    const divider2 = Bodies.rectangle(300, dividerY, 10, dividerHeight, wallOptions);
    const divider3 = Bodies.rectangle(450, dividerY, 10, dividerHeight, wallOptions);

    World.add(world, [leftWall, rightWall, divider1, divider2, divider3]);

    // 3. Floor Sensor
    const floorSensor = Bodies.rectangle(width / 2, height - 10, width, 20, {
      isStatic: true,
      isSensor: true, 
      render: { visible: false },
      label: 'FloorSensor'
    });
    World.add(world, floorSensor);

    // 4. Zigzag Pins
    const pins: Matter.Body[] = [];
    const pinOptions = { 
      isStatic: true, 
      render: { fillStyle: '#aaa' },
      restitution: 1.0 
    };
    
    const rows = 12;
    const cols = 8;
    const startY = 150;
    const spacingY = 50;
    
    const centers = [
        {x:300, y:400}, 
        {x:150, y:600}, {x:450, y:600},
        {x:150, y:250}, {x:450, y:250}
    ];

    const isNearPropeller = (px: number, py: number) => {
        return centers.some(c => Math.hypot(px - c.x, py - c.y) < 80);
    };
    
    for (let row = 0; row < rows; row++) {
      const y = startY + row * spacingY;
      const xOffset = row % 2 === 0 ? 0 : 35;
      
      for (let col = 0; col < cols; col++) {
        const x = 60 + col * 70 + xOffset;
        if (x > width - 40) continue;
        
        if (!isNearPropeller(x, y)) {
            const pin = Bodies.circle(x, y, 6, pinOptions);
            pins.push(pin);
        }
      }
    }
    World.add(world, pins);

    // 4.5 Rotating Propellers
    const propellerOptions = {
        isStatic: true,
        render: { fillStyle: '#f39c12' },
        chamfer: { radius: 5 }
    };
    
    const propellerCenter = Bodies.rectangle(300, 400, 140, 15, propellerOptions);
    const propellerLeft = Bodies.rectangle(150, 600, 140, 15, propellerOptions);
    const propellerRight = Bodies.rectangle(450, 600, 140, 15, propellerOptions);
    const propellerTopLeft = Bodies.rectangle(150, 250, 140, 15, propellerOptions);
    const propellerTopRight = Bodies.rectangle(450, 250, 140, 15, propellerOptions);

    World.add(world, [
        propellerCenter, 
        propellerLeft, propellerRight,
        propellerTopLeft, propellerTopRight
    ]);

    // Randomize rotation directions using Seeded RNG
    const rotationSpeed = 0.015;
    const dirCenter = rng() < 0.5 ? 1 : -1;
    const dirLeft = rng() < 0.5 ? 1 : -1;
    const dirRight = rng() < 0.5 ? 1 : -1;
    const dirTopLeft = rng() < 0.5 ? 1 : -1;
    const dirTopRight = rng() < 0.5 ? 1 : -1;

    // Rotate propellers
    Events.on(engine, 'beforeUpdate', () => {
        Matter.Body.rotate(propellerCenter, rotationSpeed * dirCenter);
        Matter.Body.rotate(propellerLeft, rotationSpeed * dirLeft); 
        Matter.Body.rotate(propellerRight, rotationSpeed * dirRight);
        Matter.Body.rotate(propellerTopLeft, rotationSpeed * dirTopLeft);
        Matter.Body.rotate(propellerTopRight, rotationSpeed * dirTopRight);
    });

    // 5. Balls (From Players)
    const ballOptions = (color: string, label: string) => ({
      restitution: 0.95, 
      friction: 0.001,
      frictionAir: 0.01,
      density: 0.05, 
      render: { fillStyle: color },
      label: label
    });

    const ballRadius = 16; 
    const dropY = -50; 
    const centerX = width / 2;
    
    const balls = players.map((player, index) => {
        const offset = (index - 1.5) * 20; 
        const startX = centerX + offset;
        // Use RNG for jitter
        const jitter = (rng() - 0.5) * 10; 
        const randomHeight = rng() * 20;
        
        return Bodies.circle(
            startX + jitter, 
            dropY + randomHeight, 
            ballRadius, 
            ballOptions(player.color, player.id)
        );
    });
    
    World.add(world, balls);

    // 6. Collision Event
    Events.on(engine, 'collisionStart', (event) => {
      // ONLY HOST determines winner to prevent sync issues
      if (!isHost) return;

      const pairs = event.pairs;
      
      for (let i = 0; i < pairs.length; i++) {
        const { bodyA, bodyB } = pairs[i];
        
        if (bodyA.label === 'FloorSensor' || bodyB.label === 'FloorSensor') {
          const ballBody = bodyA.label === 'FloorSensor' ? bodyB : bodyA;
          
          if (ballBody.label && ballBody.label !== 'FloorSensor') {
             const winningPlayer = players.find(p => p.id === ballBody.label);
             if (winningPlayer) {
                 setWinner(winningPlayer);
                 Matter.Runner.stop(runner); 
                 
                 // Broadcast winner
                 if (channelRef.current) {
                     channelRef.current.send({
                         type: 'broadcast',
                         event: 'game_winner',
                         payload: { winnerId: winningPlayer.id }
                     });
                 }
                 return; 
             }
          }
        }
      }
    });

    // Run
    Render.run(render);
    const runner = Runner.create();
    runnerRef.current = runner;
    Runner.run(runner, engine);

    return () => {
      Render.stop(render);
      Runner.stop(runner);
      if (render.canvas) render.canvas.remove();
      World.clear(world, false);
      Engine.clear(engine);
    };
  }, [players, randomSeed, isHost]); 

  // --- UI ---
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white relative">
      <h1 className="text-3xl font-bold mb-4">Death Pinball (4 Players)</h1>
      
      <div className="relative">
        <div 
          ref={sceneRef} 
          className="border-4 border-gray-700 rounded-lg overflow-hidden shadow-2xl bg-gray-800"
          style={{ width: 600, height: 800 }}
        />
        
        {winner && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-10 p-8 text-center animate-fade-in">
             <div 
                className="w-24 h-24 rounded-full mb-6 border-4 border-white shadow-lg animate-bounce"
                style={{ backgroundColor: winner.color }}
             />
             <h2 className="text-5xl font-black text-white mb-2">
               {winner.name} Wins!
             </h2>
             <p className="text-xl text-gray-300 mb-8">
               Color: {winner.colorName}
             </p>
             
             {isHost ? (
                <button 
                onClick={() => {
                    if (channelRef.current) {
                        channelRef.current.send({
                            type: 'broadcast',
                            event: 'restart_game',
                            payload: {}
                        });
                    }
                    onRestart();
                }}
                className="px-8 py-3 bg-gradient-to-r from-pink-500 to-yellow-500 text-white font-bold text-xl rounded-full hover:scale-105 transition transform shadow-lg"
                >
                Play Again
                </button>
             ) : (
                 <p className="text-yellow-400 animate-pulse font-bold text-xl">Waiting for Host to restart...</p>
             )}
           </div>
        )}
      </div>

      <div className="mt-6 flex gap-4">
        {players.map(p => (
            <div key={p.id} className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }} />
                <span className={winner?.id === p.id ? 'font-bold text-yellow-400' : 'text-gray-400'}>
                    {p.name}
                </span>
            </div>
        ))}
      </div>
    </div>
  );
};

export default PinballBoard;