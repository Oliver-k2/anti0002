import React, { useRef, useEffect, useState } from 'react';
import { ref, set, onValue, update } from 'firebase/database';
import { db } from '../firebase';

const CANVAS_W = 800;
const CANVAS_H = 600;
const TILE = 5;
const COLS = CANVAS_W / TILE;
const ROWS = CANVAS_H / TILE;
const TOTAL_PLAYABLE_AREA = (COLS - 4) * (ROWS - 4); // 패딩 제외 면적

const images = ["/bg1.png", "/bg2.png"];

const GameCanvas = ({ user, isMobile }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [gameState, setGameState] = useState('playing'); // playing, dead, clear
  const [level, setLevel] = useState(1);
  const [percent, setPercent] = useState(0);

  // 게임 로직에 필요한 가변 상태들 (ref로 관리하여 렌더링 의존성 제거)
  const grid = useRef(new Uint8Array(COLS * ROWS));
  const trailRef = useRef([]);
  const player = useRef({ x: COLS / 2, y: ROWS - 2 }); // 시작 위치 바닥 중앙
  const bosses = useRef([]);
  const bgImgRef = useRef(new Image());
  const keys = useRef({ ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, w: false, a: false, s: false, d: false });

  // 초기화 함수
  const initGame = (targetLevel) => {
    bgImgRef.current.src = images[(targetLevel - 1) % images.length];
    
    const g = new Uint8Array(COLS * ROWS);
    // 테두리 2칸씩 Base(1)로 설정
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (r <= 1 || r >= ROWS - 2 || c <= 1 || c >= COLS - 2) {
          g[r * COLS + c] = 1;
        }
      }
    }
    grid.current = g;
    trailRef.current = [];
    player.current = { x: COLS / 2, y: ROWS - 2 };
    
    // 보스 생성 (레벨에 비례하여 개수나 스피드 증가)
    const newBosses = [];
    for (let i = 0; i < Math.min(targetLevel, 5); i++) {
        newBosses.push({
            x: (100 + Math.random() * 600),
            y: (100 + Math.random() * 200),
            vx: (Math.random() > 0.5 ? 1 : -1) * (2 + targetLevel * 0.5),
            vy: (Math.random() > 0.5 ? 1 : -1) * (2 + targetLevel * 0.5)
        });
    }
    bosses.current = newBosses;
    setPercent(0);
    setGameState('playing');
  };

  useEffect(() => {
    initGame(level);
  }, [level]);

  // 리더보드 싱크
  useEffect(() => {
    const lbRef = ref(db, 'arcadeLeaderboard');
    const unsub = onValue(lbRef, (snap) => {
        const data = snap.val() || {};
        const sorted = Object.values(data).sort((a, b) => b.level !== a.level ? b.level - a.level : b.score - a.score).slice(0, 5);
        setLeaderboard(sorted);
    });
    return () => unsub();
  }, []);

  const updateLeaderboardRecord = (p, lvl) => {
      const myRecord = { uid: user.uid, nickname: user.nickname, color: user.color, score: Math.round(p), level: lvl };
      update(ref(db, `arcadeLeaderboard`), { [user.uid]: myRecord });
  };

  // 게임 루프 및 렌더링
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    const handleKeyDown = (e) => { 
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
        keys.current[e.key] = true; 
    };
    const handleKeyUp = (e) => { keys.current[e.key] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    let animationId;
    let frames = 0;

    const fillEnclosed = () => {
        const temp = new Uint8Array(COLS * ROWS);
        const q = [];
        // 보스가 있는 공간은 비어있는(0) 안전한 바다로 인식
        bosses.current.forEach(b => {
            const bx = Math.floor(b.x / TILE);
            const by = Math.floor(b.y / TILE);
            if (bx >= 0 && bx < COLS && by >= 0 && by < ROWS) {
                if (grid.current[by * COLS + bx] === 0 || grid.current[by * COLS + bx] === 2) {
                    temp[by * COLS + bx] = 1;
                    q.push({x: bx, y: by});
                }
            }
        });

        // 큐를 써서 DFS/BFS 전파 (Flood Fill)
        let head = 0;
        while(head < q.length) {
            const p = q[head++];
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            for (let d of dirs) {
                const nx = p.x + d[0]; const ny = p.y + d[1];
                if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
                    // 보스가 지나는 길이기 때문에 해당 0은 채우지 않음(살려둠)
                    if (grid.current[ny * COLS + nx] === 0 && temp[ny * COLS + nx] === 0) {
                        temp[ny * COLS + nx] = 1;
                        q.push({x: nx, y: ny});
                    }
                }
            }
        }

        let baseCount = 0;
        for (let i = 0; i < COLS * ROWS; i++) {
            if (grid.current[i] === 2) {
                grid.current[i] = 1; // 꼬리를 땅으로 편입
            } else if (grid.current[i] === 0 && temp[i] === 0) {
                grid.current[i] = 1; // 갇힌 공간을 내 땅으로 편입!
            }
            if (grid.current[i] === 1) baseCount++;
        }

        const currentPct = (baseCount / TOTAL_PLAYABLE_AREA) * 100;
        setPercent(currentPct);
        updateLeaderboardRecord(currentPct, level);

        if (currentPct >= 75) {
            setGameState('clear');
        }
    };

    const looseGame = () => {
        setGameState('dead');
        // 죽는 이펙트를 위해 꼬리를 빨갛게 표시 등 가능
    };

    const loop = () => {
        if (gameState !== 'playing') {
            animationId = requestAnimationFrame(loop);
            return;
        }

        // --- 물리 업데이트 ---
        // 플레이어 이동 속도 (초당 60프레임 기준 TILE 사이즈만큼)
        // 1칸씩 정밀 제어를 위해 프레임 카운터를 써도 좋고, 여기선 간단히 1frame=1px가 아닌 1칸씩 이동
        let p = player.current;
        let targetX = p.x; let targetY = p.y;
        
        // 이동 키 판별
        if (keys.current.ArrowUp || keys.current.w) targetY -= 1;
        else if (keys.current.ArrowDown || keys.current.s) targetY += 1;
        else if (keys.current.ArrowLeft || keys.current.a) targetX -= 1;
        else if (keys.current.ArrowRight || keys.current.d) targetX += 1;

        // 화면 밖으로 나가지 못함
        if (targetX < 0) targetX = 0;
        if (targetX >= COLS) targetX = COLS - 1;
        if (targetY < 0) targetY = 0;
        if (targetY >= ROWS) targetY = ROWS - 1;

        if (targetX !== p.x || targetY !== p.y) {
            const targetIdx = targetY * COLS + targetX;
            const targetType = grid.current[targetIdx];

            if (targetType === 0) { // 바다로 전진
                // 시작 꼬리 기록
                trailRef.current.push({ x: p.x, y: p.y });
                // 꼬리 그리기 (현재 위치)
                grid.current[p.y * COLS + p.x] = 2;
                player.current = { x: targetX, y: targetY };
            } 
            else if (targetType === 2) { // 꼬리와 충돌
                const trail = trailRef.current;
                // 이전 꼬리인지(후진) 판별
                if (trail.length > 0 && trail[trail.length - 1].x === targetX && trail[trail.length - 1].y === targetY) {
                    // 뒤로 가기 (꼬리 깎기)
                    grid.current[p.y * COLS + p.x] = 0; // 지우기
                    trail.pop(); // 한칸 지움
                    player.current = { x: targetX, y: targetY };
                } else {
                    // 내 꼬리를 밟아서 사망
                    looseGame();
                }
            } 
            else if (targetType === 1) { // 베이스에 안전하게 착륙!
                if (trailRef.current.length > 0) {
                    grid.current[p.y * COLS + p.x] = 2; // 막틱 채우고
                    player.current = { x: targetX, y: targetY };
                    trailRef.current = [];
                    // 영역 채우기 로직 발동
                    fillEnclosed();
                } else {
                    // 꼬리 없이 베이스 위를 주행 중
                    player.current = { x: targetX, y: targetY };
                }
            }
        }

        // 보스 이동 및 충돌
        bosses.current.forEach(boss => {
            boss.x += boss.vx;
            boss.y += boss.vy;

            // 바운싱 로직 (벽(base)에 부딪히면 튕김)
            const bGridX = Math.floor(boss.x / TILE);
            const bGridY = Math.floor(boss.y / TILE);
            
            if (bGridX >= 0 && bGridX < COLS && bGridY >= 0 && bGridY < ROWS) {
                if (grid.current[bGridY * COLS + bGridX] === 1) {
                    // 정밀한 반사를 위해 이전 위치 활용
                    const prevX = Math.floor((boss.x - boss.vx) / TILE);
                    const prevY = Math.floor((boss.y - boss.vy) / TILE);
                    if (grid.current[bGridY * COLS + prevX] === 1) boss.vy *= -1.05; // 약간 속도 증가
                    else if (grid.current[prevY * COLS + bGridX] === 1) boss.vx *= -1.05;
                    else { boss.vx *= -1; boss.vy *= -1; }
                } 
                else if (grid.current[bGridY * COLS + bGridX] === 2) {
                    // 꼬리를 자름 -> 사망!
                    looseGame();
                }
            } else {
                boss.vx *= -1; boss.vy *= -1; // 맵 밖으로 나가면
            }
        });

        // 플레이어 본체 몸통박치기 체크
        if (trailRef.current.length > 0) {
           bosses.current.forEach(boss => {
              const bGridX = Math.floor(boss.x / TILE);
              const bGridY = Math.floor(boss.y / TILE);
              if (bGridX === player.current.x && bGridY === player.current.y) looseGame();
           });
        }

        // --- 렌더링 ---
        // 1. 고해상도 백그라운드 뿌리기
        if (bgImgRef.current.complete) {
            ctx.drawImage(bgImgRef.current, 0, 0, CANVAS_W, CANVAS_H);
        } else {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        // 2. 안먹은 구역(0) 검은색 칠하기 (가리기)
        ctx.fillStyle = '#000000';
        for(let r=0; r<ROWS; r++) {
            let startC = -1;
            for(let c=0; c<COLS; c++) {
                if (grid.current[r*COLS + c] === 0) {
                    if (startC === -1) startC = c;
                } else {
                    if (startC !== -1) {
                        ctx.fillRect(startC * TILE, r * TILE, (c - startC) * TILE, TILE);
                        startC = -1;
                    }
                }
            }
            if (startC !== -1) ctx.fillRect(startC * TILE, r * TILE, (COLS - startC) * TILE, TILE);
        }

        // 3. 꼬리 및 외곽선 테두리 이펙트
        ctx.fillStyle = '#ef4444'; // 꼬리
        for(let r=0; r<ROWS; r++) {
             for(let c=0; c<COLS; c++) {
                 if (grid.current[r*COLS + c] === 2) {
                     ctx.shadowBlur = 10; ctx.shadowColor = '#ef4444';
                     ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
                     ctx.shadowBlur = 0;
                 }
             }
        }

        // 4. 플레이어
        ctx.fillStyle = user.color || '#3b82f6';
        ctx.shadowBlur = 15; ctx.shadowColor = user.color || '#3b82f6';
        const px = player.current.x * TILE; const py = player.current.y * TILE;
        ctx.fillRect(px - 2, py - 2, TILE + 4, TILE + 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.shadowBlur = 0;

        // 5. 보스
        bosses.current.forEach(boss => {
            ctx.fillStyle = '#eab308';
            ctx.shadowBlur = 20; ctx.shadowColor = '#facc15';
            ctx.beginPath();
            ctx.arc(boss.x, boss.y, TILE * 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        // 6. 스캐터 이펙트나 그리드 라인을 약간 (옵션)
        ctx.strokeStyle = 'rgba(255,255,255,0.02)';
        ctx.strokeRect(0, 0, CANVAS_W, CANVAS_H);

        animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);
    
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        cancelAnimationFrame(animationId);
    };
  }, [gameState, level]);

  // 비율에 맞게 스케일링 설정
  const getScale = () => {
    if (!containerRef.current) return 1;
    const { clientWidth, clientHeight } = containerRef.current;
    const scaleX = clientWidth / CANVAS_W;
    const scaleY = clientHeight / CANVAS_H;
    return Math.min(scaleX, scaleY) * 0.95; // 패딩을 위해 95%
  };

  const [scale, setScale] = useState(1);
  useEffect(() => {
    const rs = () => setScale(getScale());
    window.addEventListener('resize', rs);
    setTimeout(rs, 100);
    return () => window.removeEventListener('resize', rs);
  }, []);

  const handleTouch = (e) => {
    if (!isMobile) return;
    if (e.cancelable) e.preventDefault(); 
    if (e.type === 'touchend' || e.touches.length === 0) {
      keys.current.w = keys.current.s = keys.current.a = keys.current.d = false;
      return;
    }
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left; const y = touch.clientY - rect.top;
    const dx = x - rect.width / 2; const dy = y - rect.height / 2;
    keys.current.w = keys.current.s = keys.current.a = keys.current.d = false;

    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) keys.current.d = true; else keys.current.a = true;
    } else {
      if (dy > 0) keys.current.s = true; else keys.current.w = true;
    }
  };

  return (
    <div ref={containerRef} style={{ flex: 1, backgroundColor: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      
      {/* 백그라운드 효과 */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', background: 'radial-gradient(circle at center, transparent 40%, #020617 100%)' }}></div>
      
      <div style={{ position: 'absolute', top: 10, left: 20, zIndex: 10 }}>
         <h2 style={{ color: 'white', margin: 0, textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>STAGE {level}</h2>
         <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5 }}>
            <div style={{ width: 200, height: 16, background: '#1e293b', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155' }}>
                <div style={{ width: `${Math.min(percent, 75)*(100/75)}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #06b6d4)', transition: 'width 0.3s' }}></div>
            </div>
            <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>{percent.toFixed(1)}% / 75.0%</span>
         </div>
      </div>

      <div className="panel" style={{ position: 'absolute', top: 16, right: 16, width: 200, pointerEvents: 'none', background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(10px)' }}>
        <div className="panel-header" style={{ padding: '8px 12px', fontSize: '0.8rem' }}>
          <span>아케이드 랭킹 🏆</span>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leaderboard.map((u, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '70%' }}>
                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{idx + 1}</span>
                <span style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: u.uid === user.uid ? '#38bdf8' : 'white' }}>{u.nickname}</span>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#10b981' }}>Lv.{u.level}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 캔버스 래퍼 (안티앨리어싱 없애기 위해 렌더링 최적화) */}
      <canvas 
          ref={canvasRef} 
          width={CANVAS_W} 
          height={CANVAS_H} 
          style={{ 
              transform: `scale(${scale})`, 
              boxShadow: '0 0 40px rgba(56, 189, 248, 0.4)',
              border: '2px solid rgba(56, 189, 248, 0.5)',
              borderRadius: 4,
              outline: 'none', touchAction: 'none'
          }} 
          tabIndex={0}
          onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch} onTouchCancel={handleTouch}
      />

      {gameState === 'dead' && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <h1 style={{ color: '#ef4444', fontSize: '4rem', margin: 0, textShadow: '0 0 20px rgba(239, 68, 68, 0.5)' }}>GAME OVER</h1>
          <p style={{ color: '#fff', fontSize: '1.2rem', marginTop: '10px', marginBottom: '30px' }}>스테이지 {level}에서 {percent.toFixed(1)}% 달성</p>
          <button onClick={() => initGame(1)} style={{ padding: '16px 32px', fontSize: '1.2rem', background: '#3b82f6', color: 'white', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)' }}>
            처음부터 다시하기
          </button>
        </div>
      )}

      {gameState === 'clear' && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(16, 185, 129, 0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <h1 style={{ color: '#fff', fontSize: '4rem', margin: 0, textShadow: '0 0 20px rgba(255, 255, 255, 0.5)' }}>STAGE CLEAR!</h1>
          <p style={{ color: '#fff', fontSize: '1.2rem', marginTop: '10px', marginBottom: '30px' }}>멋지게 땅을 차지했습니다!</p>
          <button onClick={() => setLevel(l => l + 1)} style={{ padding: '16px 32px', fontSize: '1.2rem', background: '#0f172a', color: 'white', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)' }}>
            다음 스테이지로
          </button>
        </div>
      )}
    </div>
  );
};

export default GameCanvas;
