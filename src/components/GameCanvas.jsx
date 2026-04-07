import React, { useRef, useEffect, useState, memo } from 'react';
import { ref, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, set, update, remove, get } from 'firebase/database';
import { db } from '../firebase';
import { throttle } from 'lodash';

// 맵 상수를 확장
const TILE_SIZE = 12; // PC 해상도에 맞춰 약간 키움
const WORLD_WIDTH = 2500;
const WORLD_HEIGHT = 2000;

const GameCanvas = ({ user }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [leaderboard, setLeaderboard] = useState([]);
  
  const playersRef = useRef(new Map());
  const tilesRef = useRef(new Map()); 
  
  const myPos = useRef({ 
    x: user.isAdmin ? WORLD_WIDTH / 2 : Math.floor((Math.random() * WORLD_WIDTH)/TILE_SIZE) * TILE_SIZE, 
    y: user.isAdmin ? WORLD_HEIGHT / 2 : Math.floor((Math.random() * WORLD_HEIGHT)/TILE_SIZE) * TILE_SIZE 
  });

  const syncPositionToFirebase = useRef(
    throttle((pos) => {
      update(ref(db, `players/${user.uid}`), { x: pos.x, y: pos.y });
    }, 100)
  ).current;

  const paintTile = (x, y) => {
    if (user.isAdmin) return;
    const tileKey = `${x}_${y}`;
    const newTile = { uid: user.uid, color: user.color, nickname: user.nickname };
    tilesRef.current.set(tileKey, newTile);
    update(ref(db, 'tiles'), { [tileKey]: newTile }).catch(console.error);
  };

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let myPlayerRef = null;
    if (!user.isAdmin) {
      myPlayerRef = ref(db, `players/${user.uid}`);
      set(myPlayerRef, {
        uid: user.uid,
        nickname: user.nickname,
        color: user.color,
        x: myPos.current.x,
        y: myPos.current.y
      });
      onDisconnect(myPlayerRef).remove();
    }

    const handlePlayerAdded = (snap) => playersRef.current.set(snap.key, snap.val());
    const handlePlayerChanged = (snap) => playersRef.current.set(snap.key, snap.val());
    const handlePlayerRemoved = (snap) => playersRef.current.delete(snap.key);
    
    const playersDbRef = ref(db, 'players');
    onChildAdded(playersDbRef, handlePlayerAdded);
    onChildChanged(playersDbRef, handlePlayerChanged);
    onChildRemoved(playersDbRef, handlePlayerRemoved);

    const handleTileAdded = (snap) => tilesRef.current.set(snap.key, snap.val());
    const handleTileChanged = (snap) => tilesRef.current.set(snap.key, snap.val());
    const handleTileRemoved = (snap) => tilesRef.current.delete(snap.key);
    
    const tilesDbRef = ref(db, 'tiles');
    get(tilesDbRef).then(snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        Object.keys(data).forEach(k => tilesRef.current.set(k, data[k]));
      }
      onChildAdded(tilesDbRef, handleTileAdded);
      onChildChanged(tilesDbRef, handleTileChanged);
      onChildRemoved(tilesDbRef, handleTileRemoved);
    });

    if (!user.isAdmin) {
      paintTile(myPos.current.x, myPos.current.y);
    }

    return () => {
      if (myPlayerRef) remove(myPlayerRef);
    };
  }, [user.uid, user.isAdmin]);

  useEffect(() => {
    const keys = {};
    const handleKeyDown = (e) => { 
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
      keys[e.key] = true; 
    };
    const handleKeyUp = (e) => { keys[e.key] = false; };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    let moveRaf;
    const moveLoop = () => {
      let moved = false;
      const speed = user.isAdmin ? TILE_SIZE * 3 : TILE_SIZE;
      const newPos = { ...myPos.current };
      
      if ((keys['w'] || keys['ArrowUp']) && newPos.y > 0) { newPos.y -= speed; moved = true; }
      else if ((keys['s'] || keys['ArrowDown']) && newPos.y < WORLD_HEIGHT - TILE_SIZE) { newPos.y += speed; moved = true; }
      else if ((keys['a'] || keys['ArrowLeft']) && newPos.x > 0) { newPos.x -= speed; moved = true; }
      else if ((keys['d'] || keys['ArrowRight']) && newPos.x < WORLD_WIDTH - TILE_SIZE) { newPos.x += speed; moved = true; }

      if (moved) {
        myPos.current = newPos;
        if (!user.isAdmin) {
          keys['w'] = keys['s'] = keys['a'] = keys['d'] = false;
          keys['ArrowUp'] = keys['ArrowDown'] = keys['ArrowLeft'] = keys['ArrowRight'] = false;
          paintTile(newPos.x, newPos.y);
          syncPositionToFirebase(newPos);
        }
      }
      moveRaf = setTimeout(moveLoop, 50);
    };
    moveLoop();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearTimeout(moveRaf);
    };
  }, [user.isAdmin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let renderRafId;

    const render = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#020617'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cameraX = Math.floor(canvas.width / 2) - myPos.current.x;
      const cameraY = Math.floor(canvas.height / 2) - myPos.current.y;
      ctx.translate(cameraX, cameraY);

      ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= WORLD_WIDTH; x += TILE_SIZE * 10) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke();
      }
      for (let y = 0; y <= WORLD_HEIGHT; y += TILE_SIZE * 10) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke();
      }
      
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      const scoreMap = new Map();
      const viewportXLeft = myPos.current.x - canvas.width / 2;
      const viewportXRight = myPos.current.x + canvas.width / 2;
      const viewportYTop = myPos.current.y - canvas.height / 2;
      const viewportYBottom = myPos.current.y + canvas.height / 2;

      tilesRef.current.forEach((tile, key) => {
        const [strX, strY] = key.split('_');
        const x = parseInt(strX, 10);
        const y = parseInt(strY, 10);

        if (x + TILE_SIZE >= viewportXLeft && x <= viewportXRight && y + TILE_SIZE >= viewportYTop && y <= viewportYBottom) {
          ctx.fillStyle = tile.color;
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE); 
        }

        if (!scoreMap.has(tile.uid)) {
          scoreMap.set(tile.uid, { nickname: tile.nickname, count: 0, color: tile.color });
        }
        scoreMap.get(tile.uid).count += 1;
      });

      const sortedLeaderboard = Array.from(scoreMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      setLeaderboard(sortedLeaderboard);

      playersRef.current.forEach((player) => {
        if (player.x + TILE_SIZE < viewportXLeft || player.x > viewportXRight || player.y + TILE_SIZE < viewportYTop || player.y > viewportYBottom) return;

        ctx.shadowBlur = 10;
        ctx.shadowColor = player.color;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(player.x - 1, player.y - 1, TILE_SIZE + 2, TILE_SIZE + 2);
        
        ctx.fillStyle = player.color;
        ctx.fillRect(player.x, player.y, TILE_SIZE, TILE_SIZE);
        ctx.shadowBlur = 0;

        ctx.font = 'bold 12px Outfit, sans-serif';
        ctx.textAlign = 'center';
        const textWidth = ctx.measureText(player.nickname).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(player.x + TILE_SIZE / 2 - textWidth / 2 - 6, player.y - 22, textWidth + 12, 16);
        ctx.fillStyle = 'white';
        ctx.fillText(player.nickname, player.x + TILE_SIZE / 2, player.y - 10);
      });

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      
      const minimapSize = 180;
      const minimapScale = minimapSize / Math.max(WORLD_WIDTH, WORLD_HEIGHT);
      const padding = 24;
      const mmX = padding;
      const mmY = canvas.height - minimapSize - padding;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(mmX, mmY, minimapSize, minimapSize, 12);
      ctx.clip();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(mmX, mmY, minimapSize, minimapSize);

      tilesRef.current.forEach((tile, key) => {
        const [strX, strY] = key.split('_');
        const x = parseInt(strX, 10);
        const y = parseInt(strY, 10);
        ctx.fillStyle = tile.color;
        ctx.fillRect(mmX + x * minimapScale, mmY + y * minimapScale, Math.max(1, TILE_SIZE * minimapScale), Math.max(1, TILE_SIZE * minimapScale));
      });

      playersRef.current.forEach((player) => {
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.arc(mmX + player.x * minimapScale, mmY + player.y * minimapScale, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      const vpW = canvas.width * minimapScale;
      const vpH = canvas.height * minimapScale;
      ctx.strokeRect(mmX + viewportXLeft * minimapScale, mmY + viewportYTop * minimapScale, vpW, vpH);
      
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.strokeRect(mmX, mmY, minimapSize, minimapSize);

      renderRafId = requestAnimationFrame(render);
    };

    renderRafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(renderRafId);
  }, []);

  return (
    <div ref={containerRef} style={{ flex: 1, backgroundColor: '#000', overflow: 'hidden', position: 'relative' }}>
      <canvas 
        ref={canvasRef} 
        style={{ display: 'block', outline: 'none' }}
        tabIndex={0}
      />
      
      {/* Floating Leaderboard */}
      <div className="panel" style={{ position: 'absolute', top: 16, right: 16, width: 200, background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(10px)' }}>
        <div className="panel-header" style={{ padding: '10px 16px', fontSize: '0.85rem' }}>
          <span>실시간 순위 🏆</span>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leaderboard.length === 0 ? <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>데이터 없음</p> : 
            leaderboard.map((u, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '70%' }}>
                  <span style={{ fontSize: '0.8rem', opacity: 0.7, fontWeight: 'bold' }}>{idx + 1}</span>
                  <div style={{ minWidth: 8, height: 8, background: u.color, borderRadius: 2 }}></div>
                  <span style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nickname}</span>
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{u.count}</span>
              </div>
            ))
          }
        </div>
      </div>

      {!user.isAdmin && (
        <div style={{ position: 'absolute', bottom: 24, right: 24, pointerEvents: 'none', textAlign: 'right' }}>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 2 }}>Arrow Keys or WASD to Move</p>
        </div>
      )}
    </div>
  );
};

export default memo(GameCanvas);
