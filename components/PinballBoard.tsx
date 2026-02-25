'use client';

import React, { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { supabase } from '@/lib/supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import seedrandom from 'seedrandom';

export type CharacterType = 'normal' | 'teleport' | 'gravity';

export type Player = {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isHost: boolean;
  isReady: boolean;
  character: CharacterType;
};

interface PinballBoardProps {
  players: Player[];
  roomId: string;
  randomSeed: string;
  isHost: boolean;
  myId: string;
  onRestart: () => void;
}

const PinballBoard: React.FC<PinballBoardProps> = ({ players, roomId, randomSeed, isHost, myId, onRestart }) => {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  
  const [loser, setLoser] = useState<Player | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const finishedPlayersRef = useRef<Set<string>>(new Set());
  const [finishedPlayerIds, setFinishedPlayerIds] = useState<Set<string>>(new Set());
  const ballsRef = useRef<Matter.Body[]>([]);
  const frameCounterRef = useRef<number>(0);
  const teleportEffectsRef = useRef<{ ballId: number; endFrame: number }[]>([]);
  const gravityEffectRef = useRef<{ dir: { x: number; y: number }; endFrame: number } | null>(null);

  // Camera Control Logic
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAutoScrollingRef = useRef(false);

  const handleScroll = () => {
      if (isAutoScrollingRef.current) {
          isAutoScrollingRef.current = false;
          return;
      }
      isUserScrollingRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
          isUserScrollingRef.current = false;
      }, 1000);
  };

  const getCharIcon = (char: CharacterType) => {
      if (char === 'teleport') return '⚡️';
      if (char === 'gravity') return '🧲';
      return '';
  };

  // --- Realtime Sync ---
  useEffect(() => {
      if (!roomId) return;

      const channel = supabase.channel(`room:${roomId}`, {
        config: { broadcast: { self: true } }
      });

      let syncInterval: NodeJS.Timeout;

      channel
        .on('broadcast', { event: 'game_loser' }, ({ payload }) => {
            if (payload.loserId) {
                const loserPlayer = players.find(p => p.id === payload.loserId);
                if (loserPlayer) {
                    setLoser(loserPlayer);
                    if (runnerRef.current) Matter.Runner.stop(runnerRef.current);
                }
            }
        })
        .on('broadcast', { event: 'restart_game' }, () => {
            onRestart();
        })
        .on('broadcast', { event: 'sync_state' }, ({ payload }) => {
            if (isHost) return; 

            if (payload.balls && ballsRef.current.length > 0) {
                payload.balls.forEach((syncBall: any) => {
                    const localBall = ballsRef.current.find(b => b.label === syncBall.id);
                    if (localBall) {
                        Matter.Body.setPosition(localBall, { x: syncBall.x, y: syncBall.y });
                        Matter.Body.setVelocity(localBall, { x: syncBall.vx, y: syncBall.vy });
                        Matter.Body.setAngularVelocity(localBall, syncBall.av);
                    }
                });
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED' && isHost) {
                syncInterval = setInterval(() => {
                    if (!ballsRef.current || ballsRef.current.length === 0) return;
                    
                    const ballData = ballsRef.current.map(b => ({
                        id: b.label,
                        x: b.position.x, 
                        y: b.position.y,
                        vx: b.velocity.x,
                        vy: b.velocity.y,
                        av: b.angularVelocity
                    }));

                    channel.send({
                        type: 'broadcast',
                        event: 'sync_state',
                        payload: { balls: ballData }
                    });
                }, 1000);
            }
        });

      channelRef.current = channel;

      return () => {
          supabase.removeChannel(channel);
          if (syncInterval) clearInterval(syncInterval);
      };
  }, [roomId, players, onRestart, isHost]);


  // --- Physics Engine ---
  useEffect(() => {
    if (!sceneRef.current || players.length === 0) return;
    if (loser) return; 

    finishedPlayersRef.current = new Set();
    frameCounterRef.current = 0;
    const rng = seedrandom(randomSeed);

    const Engine = Matter.Engine;
    const Render = Matter.Render;
    const Runner = Matter.Runner;
    const World = Matter.World;
    const Bodies = Matter.Bodies;
    const Events = Matter.Events;
    const Composite = Matter.Composite;
    const Body = Matter.Body;
    const Collision = Matter.Collision; 

    const engine = Engine.create();
    const world = engine.world;
    
    // Reduce overall physics speed to 90%
    engine.gravity.y = 0.45; 
    engine.timing.timeScale = 0.9;

    engineRef.current = engine;

    const width = 600;
    const height = 1600; 

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

    // --- 2. Walls ---
    const wallOptions = { isStatic: true, render: { fillStyle: '#555' } };
    const leftWall = Bodies.rectangle(10, height / 2, 20, height, wallOptions);
    const rightWall = Bodies.rectangle(width - 10, height / 2, 20, height, wallOptions);
    World.add(world, [leftWall, rightWall]);

    // --- 3. Floor Sensor ---
    const floorSensor = Bodies.rectangle(width / 2, height - 10, width, 40, {
      isStatic: true,
      isSensor: true, 
      render: { visible: false },
      label: 'FloorSensor'
    });
    World.add(world, floorSensor);

    // --- 4. Map Design ---
    const pegs: Matter.Body[] = [];
    const rows = 6; 
    const cols = 7;
    const spacingX = 60;
    const spacingY = 80;

    const createPegBlock = (startY: number) => {
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const offset = row % 2 === 0 ? 0 : 30;
                const x = 100 + col * spacingX + offset;
                const y = startY + row * spacingY;
                if (x > width - 30 || x < 30) continue;
                pegs.push(Bodies.circle(x, y, 8, { isStatic: true, restitution: 0.6, render: { fillStyle: '#6F4E37' } }));
            }
        }
    };
    createPegBlock(150); 
    createPegBlock(950); 
    World.add(world, pegs);

    // Funnel
    const funnelLeft = Bodies.rectangle(100, 1400, 234, 20, { isStatic: true, angle: Math.PI / 6, render: { fillStyle: '#6F4E37' }, friction: 0.05 });
    const funnelRight = Bodies.rectangle(500, 1400, 234, 20, { isStatic: true, angle: -Math.PI / 6, render: { fillStyle: '#6F4E37' }, friction: 0.05 });
    World.add(world, [funnelLeft, funnelRight]);

    // Cross Propellers
    const createCross = (x: number, y: number) => {
        const partA = Bodies.rectangle(x, y, 200, 20, { render: { fillStyle: '#f39c12' } });
        const partB = Bodies.rectangle(x, y, 20, 200, { render: { fillStyle: '#f39c12' } });
        return Body.create({ parts: [partA, partB], isStatic: true });
    };
    const crossTop = createCross(300, 400);
    const crossMiddle = createCross(300, 800);
    const crossBottom = createCross(300, 1200);
    
    // Conveyor Belts
    const beltOptions = { isStatic: true, render: { fillStyle: '#3498db' }, friction: 0.8 };
    const leftBelt = Bodies.rectangle(100, 850, 180, 20, beltOptions); 
    const rightBelt = Bodies.rectangle(500, 850, 180, 20, beltOptions); 

    // Exit Obstacles
    const exitPegs: Matter.Body[] = [
        Bodies.circle(300, 1436, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), 
        Bodies.circle(256, 1480, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), 
        Bodies.circle(344, 1480, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), 
        Bodies.circle(300, 1524, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), 
    ];

    // Final row of pegs (tight gap) just above floor sensor
    // Ball diameter = 30, Peg diameter = 12. Gap = 32 -> Spacing = 44
    for (let x = 168; x <= 432; x += 44) {
        exitPegs.push(Bodies.circle(x, 1560, 6, { 
            isStatic: true, 
            restitution: 0.8, 
            render: { fillStyle: '#e74c3c' } 
        }));
    }

    World.add(world, [crossTop, crossMiddle, crossBottom, leftBelt, rightBelt, ...exitPegs]);

    // --- 5. Balls ---
    const ballOptions = (color: string, label: string) => ({
      restitution: 0.8, friction: 0.005, density: 0.04, render: { fillStyle: color }, label: label
    });
    const ballRadius = 15; 
    const dropY = 50; 
    
    const balls = players.map((player, index) => {
        const startX = 200 + index * 50;
        const jitterX = (rng() - 0.5) * 2; 
        const jitterY = (rng() - 0.5) * 2;
        return Bodies.circle(startX + jitterX, dropY + jitterY, ballRadius, ballOptions(player.color, player.id));
    });
    World.add(world, balls);
    ballsRef.current = balls;

    // --- 6. Physics Loop (Skills, Anti-Stuck, Belts) ---
    Events.on(engine, 'beforeUpdate', () => {
        frameCounterRef.current++;
        const frame = frameCounterRef.current;

        // Rotate Propellers
        Matter.Body.rotate(crossTop, 0.01);
        Matter.Body.rotate(crossMiddle, -0.01); 
        Matter.Body.rotate(crossBottom, 0.01); 

        // --- SKILL LOGIC ---
        // Group alive balls by character
        const alivePlayers = players.map((p, i) => ({ player: p, ball: balls[i] }))
                                    .filter(({ player }) => player && !finishedPlayersRef.current.has(player.id));
        
        const teleportUsers = alivePlayers.filter(ap => ap.player.character === 'teleport');
        const gravityUsers = alivePlayers.filter(ap => ap.player.character === 'gravity');

                // 1. Teleport Skill (Starts at 12s, then every 10s, trigger ONCE per interval if any teleport user is alive)
                if (frame >= 720 && (frame - 720) % 600 === 0 && teleportUsers.length > 0) {
                    // Pick exactly one teleport user to cast the skill deterministically
                    const casterIndex = Math.floor(rng() * teleportUsers.length);
                    const caster = teleportUsers[casterIndex];
                    const ball = caster.ball;
        
                    // Find other alive balls to swap with
                    const otherAliveBalls = alivePlayers.filter(ap => ap.player.id !== caster.player.id).map(ap => ap.ball);
                    
                    if (otherAliveBalls.length > 0) {
                        const targetIndex = Math.floor(rng() * otherAliveBalls.length);
                        const targetBall = otherAliveBalls[targetIndex];
                        
                        // Add Teleport Effects (Duration: 30 frames ≈ 0.5s)
                        teleportEffectsRef.current.push({ ballId: ball.id, endFrame: frame + 30 });
                        teleportEffectsRef.current.push({ ballId: targetBall.id, endFrame: frame + 30 });
                        
                        // Swap Positions
                        const tempPos = { x: ball.position.x, y: ball.position.y };
                        const tempVel = { x: ball.velocity.x, y: ball.velocity.y };
                        
                        Body.setPosition(ball, { x: targetBall.position.x, y: targetBall.position.y });
                        Body.setVelocity(ball, { x: targetBall.velocity.x, y: targetBall.velocity.y });
                        
                        Body.setPosition(targetBall, tempPos);
                        Body.setVelocity(targetBall, tempVel);
                    }
                }
        
                // 2. Gravity Skill (Starts at 7s, then every 10s, trigger ONCE per interval if any gravity user is alive)
                if (frame >= 420 && (frame - 420) % 600 === 0 && gravityUsers.length > 0) {                        const directions = [
                            { x: 0, y: -12 }, // Up
                            { x: -12, y: -3 }, // Left (slight up)
                            { x: 12, y: -3 }   // Right (slight up)
                        ];
                        const dir = directions[Math.floor(rng() * directions.length)];
                        
                        // Add Gravity Effect (Duration: 30 frames ≈ 0.5s)
                        gravityEffectRef.current = { dir, endFrame: frame + 30 };
                        
                        alivePlayers.forEach(ap => {
                            Body.setVelocity(ap.ball, {
                                x: ap.ball.velocity.x + dir.x,
                                y: ap.ball.velocity.y + dir.y
                            });
                        });
                    }
        // --- Anti-Stuck & Belts ---
        balls.forEach((ball) => {
            // Anti-Stuck
            if (Math.abs(ball.velocity.x) < 0.1 && Math.abs(ball.velocity.y) < 0.1) {
                const randomForceX = (rng() - 0.5) * 0.005;
                const forceY = -0.005; 
                Body.applyForce(ball, ball.position, { x: randomForceX, y: forceY });
            }

            // Conveyor Belt Logic
            if (Collision.collides(ball, leftBelt)) {
                Body.setVelocity(ball, { x: 3, y: ball.velocity.y }); 
            }
            if (Collision.collides(ball, rightBelt)) {
                Body.setVelocity(ball, { x: -3, y: ball.velocity.y }); 
            }
        });
    });

    // --- Camera & Rendering ---
    Events.on(render, 'afterRender', () => {
        const ctx = render.context;
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(">> >> >>", 100, 855); 
        ctx.fillText("<< << <<", 500, 855); 
        ctx.font = 'bold 14px Arial';

        // Draw Teleport Effects
        const currentFrame = frameCounterRef.current;
        teleportEffectsRef.current = teleportEffectsRef.current.filter(effect => currentFrame <= effect.endFrame);
        
        teleportEffectsRef.current.forEach(effect => {
            const ball = balls.find(b => b.id === effect.ballId);
            if (ball) {
                // Lightning/Sparkle effect
                ctx.beginPath();
                ctx.arc(ball.position.x, ball.position.y, 25, 0, 2 * Math.PI);
                ctx.lineWidth = 4;
                // Flicker effect using frame count
                ctx.strokeStyle = currentFrame % 4 < 2 ? '#f1c40f' : '#f39c12'; 
                ctx.stroke();
                
                // Add some zigzag lines to simulate lightning
                ctx.beginPath();
                ctx.moveTo(ball.position.x - 15, ball.position.y - 15);
                ctx.lineTo(ball.position.x, ball.position.y - 5);
                ctx.lineTo(ball.position.x - 10, ball.position.y + 5);
                ctx.lineTo(ball.position.x + 15, ball.position.y + 15);
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#fff';
                ctx.stroke();
            }
        });

        // Draw Gravity Effect
        if (gravityEffectRef.current && currentFrame <= gravityEffectRef.current.endFrame) {
            ctx.save();
            ctx.globalAlpha = 0.2;
            ctx.font = '120px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Determine arrow based on direction
            let arrow = '⬆️';
            if (gravityEffectRef.current.dir.x < 0) arrow = '↖️';
            if (gravityEffectRef.current.dir.x > 0) arrow = '↗️';

            let viewportCenterY = 800; // fallback
            if (sceneRef.current && sceneRef.current.parentElement) {
                const container = sceneRef.current.parentElement;
                // De-scale the scroll position to canvas coordinates
                const scale = container.clientWidth / 600; 
                viewportCenterY = (container.scrollTop + container.clientHeight / 2) / scale;
            }

            ctx.fillText(`🧲 ${arrow}`, 300, viewportCenterY);
            ctx.restore();
        }

        let myBall = null;
        balls.forEach((ball, index) => {
            const player = players[index];
            if (player && Composite.get(world, ball.id, 'body')) {
                // Draw Icon + Name
                const icon = getCharIcon(player.character);
                ctx.fillText(`${icon} ${player.name}`, ball.position.x, ball.position.y - 25);
                
                if (player.id === myId) myBall = ball;
            }
        });

        if (!isUserScrollingRef.current && myBall && sceneRef.current && sceneRef.current.parentElement) {
            const container = sceneRef.current.parentElement;
            // The canvas width is 600 physically, but visually scaled to container width
            const scale = container.clientWidth / 600; 
            const targetScroll = ((myBall as any).position.y * scale) - container.clientHeight / 2;
            isAutoScrollingRef.current = true;
            container.scrollTop = targetScroll;
        }
    });

    // 7. Collision Event
    Events.on(engine, 'collisionStart', (event) => {
      const pairs = event.pairs;
      for (let i = 0; i < pairs.length; i++) {
        const { bodyA, bodyB } = pairs[i];
        
        if (bodyA.label === 'FloorSensor' || bodyB.label === 'FloorSensor') {
          const ballBody = bodyA.label === 'FloorSensor' ? bodyB : bodyA;
          if (ballBody.label && ballBody.label !== 'FloorSensor') {
             const playerId = ballBody.label;
             if (finishedPlayersRef.current.has(playerId)) continue;
             finishedPlayersRef.current.add(playerId);
             setFinishedPlayerIds(prev => new Set(prev).add(playerId));
             Composite.remove(world, ballBody);

             // Last Man Standing Logic (Win condition)
             if (!isHost) continue; // Only Host decides the winner

             const threshold = players.length > 1 ? players.length - 1 : 1;
             if (finishedPlayersRef.current.size === threshold) {
                 let winnerPlayer: Player | undefined;
                 if (players.length > 1) {
                     winnerPlayer = players.find(p => !finishedPlayersRef.current.has(p.id));
                 } else {
                     winnerPlayer = players[0];
                 }
                 
                 if (winnerPlayer) {
                     setLoser(winnerPlayer); // Display WIN!
                     Matter.Runner.stop(runner); 
                     if (channelRef.current) {
                         channelRef.current.send({
                             type: 'broadcast',
                             event: 'game_loser',
                             payload: { loserId: winnerPlayer.id }
                         });
                     }
                 }
             }
          }
        }
      }
    });

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
  }, [players, randomSeed, isHost, myId]); 

  // --- UI ---
  return (
    <div className="flex flex-col items-center h-[100dvh] bg-gray-950 text-white relative pb-[env(safe-area-inset-bottom)] overflow-hidden">
      
      {/* Sticky Header: Players */}
      <div className="z-20 w-full bg-gray-900/90 backdrop-blur-md border-b border-gray-800 p-2 md:p-4 shadow-lg flex justify-center shrink-0">
        <div className="flex flex-wrap justify-center gap-2 md:gap-4">
            {players.map(p => {
                const isFinished = finishedPlayerIds.has(p.id);
                return (
                    <div 
                        key={p.id} 
                        className={`flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1 rounded-full border transition-colors duration-500 ${
                            isFinished 
                                ? 'bg-blue-900/60 border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]' 
                                : 'bg-gray-800 border-gray-700'
                        }`}
                    >
                        <div className={`w-3 h-3 md:w-4 md:h-4 rounded-full ${isFinished ? 'opacity-50' : ''}`} style={{ backgroundColor: p.color }} />
                        <span className={`text-xs md:text-sm truncate max-w-[80px] md:max-w-none ${
                            loser?.id === p.id 
                                ? 'font-bold text-yellow-400 underline' 
                                : isFinished 
                                    ? 'text-blue-200/70 line-through' 
                                    : 'text-gray-300 font-medium'
                        }`}>
                            {getCharIcon(p.character)} {p.name}
                        </span>
                    </div>
                );
            })}
        </div>
      </div>

      {/* Game Board Container */}
      <div 
        className="relative flex-1 w-full max-w-[600px] mt-2 md:mt-4 mb-2 md:mb-4 overflow-y-auto border-y-4 md:border-4 border-gray-700 md:rounded-lg shadow-2xl bg-gray-800 scrollbar-hide"
        onScroll={handleScroll} 
      >
        <div ref={sceneRef} className="w-full [&>canvas]:w-full [&>canvas]:max-w-[600px] [&>canvas]:h-auto" />
        {loser && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-30 p-4 text-center animate-fade-in fixed top-0 left-0 w-full h-full">
             <div className="w-24 h-24 md:w-32 md:h-32 rounded-full mb-4 md:mb-6 border-4 md:border-8 border-yellow-400 shadow-2xl animate-bounce flex items-center justify-center bg-black">
                 <span className="text-4xl md:text-6xl">🏆</span>
             </div>
             <h2 className="text-4xl md:text-6xl font-black text-white mb-2 drop-shadow-lg">WIN!</h2>
             <h3 className="text-2xl md:text-4xl font-bold text-yellow-400 mb-6 md:mb-8">{getCharIcon(loser.character)} {loser.name}</h3>
             {isHost ? (
                 <button onClick={() => { if (channelRef.current) { channelRef.current.send({ type: 'broadcast', event: 'restart_game', payload: {} }); } onRestart(); }} className="px-6 md:px-8 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold text-lg md:text-xl rounded-full hover:scale-105 transition transform shadow-lg">
                     Play Again
                 </button>
             ) : (
                 <p className="text-yellow-200 animate-pulse font-bold text-sm md:text-xl">Waiting for Host to restart...</p>
             )}
           </div>
        )}
      </div>
    </div>
  );
};

export default PinballBoard;