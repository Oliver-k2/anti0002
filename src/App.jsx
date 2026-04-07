import React, { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove, get } from 'firebase/database';
import { db } from './firebase';
import GameCanvas from './components/GameCanvas';
import Chat from './components/Chat';
import './index.css';

const PALETTE_COLORS = Array.from({ length: 100 }, (_, i) => {
  // 20종류의 완전히 다른 명확한 색상값(Hue)을 18도 단위로 나눔
  const hue = (i % 20) * 18;
  // 5단계의 명도(Lightness)를 적용하여 같은 배색이라도 밝기로 완전히 구분함
  const lightnessIndex = Math.floor(i / 20); 
  const lightness = 40 + (lightnessIndex * 10); // 40%, 50%, 60%, 70%, 80%
  return `hsl(${hue}, 85%, ${lightness}%)`;
});

function App() {
  const [user, setUser] = useState(null); // { uid, nickname, color, status }
  const [inputName, setInputName] = useState('');
  const [adminMode, setAdminMode] = useState(false);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [resetTime, setResetTime] = useState(null);
  const [timeLeft, setTimeLeft] = useState('00:00:00');
  
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isPasswordSet, setIsPasswordSet] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // 모바일 뷰 관련 상태
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent));
  // 색상 선택 관련 상태
  const [selectedColor, setSelectedColor] = useState(PALETTE_COLORS[0]);
  const [usedColors, setUsedColors] = useState(new Set());

  // 사용 중인 색상 실시간 추적 (로그인 화면용)
  useEffect(() => {
    if (user || adminMode) return;
    
    const handleSnap = (snap) => {
      const newUsed = new Set();
      if (snap.exists()) {
         Object.values(snap.val()).forEach(u => u.color && newUsed.add(u.color));
      }
      return newUsed;
    };
    
    let appColors = new Set();
    let playColors = new Set();
    
    const unsubApp = onValue(ref(db, 'approvals'), snap => {
      appColors = handleSnap(snap);
      setUsedColors(new Set([...appColors, ...playColors]));
    });
    const unsubPlay = onValue(ref(db, 'players'), snap => {
      playColors = handleSnap(snap);
      setUsedColors(new Set([...appColors, ...playColors]));
    });
    
    return () => { unsubApp(); unsubPlay(); };
  }, [user, adminMode]);

  useEffect(() => {
    const configRef = ref(db, 'config/resetTimer');
    const unsubscribe = onValue(configRef, (snapshot) => {
      if (snapshot.exists()) {
        setResetTime(snapshot.val());
      } else {
        const nextTime = Date.now() + 24 * 60 * 60 * 1000;
        set(ref(db, 'config/resetTimer'), nextTime);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!resetTime) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const diff = resetTime - now;
      if (diff <= 0) {
        setTimeLeft('00:00:00');
        if (Math.abs(diff) < 5000) { 
          handleResetData();
        }
      } else {
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24).toString().padStart(2, '0');
        const m = Math.floor((diff / 1000 / 60) % 60).toString().padStart(2, '0');
        const s = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
        setTimeLeft(`${h}:${m}:${s}`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [resetTime]);

  const handleResetData = () => {
    const nextTime = Date.now() + 24 * 60 * 60 * 1000;
    const updates = {};
    updates['config/resetTimer'] = nextTime;
    updates['chat'] = null;
    updates['players'] = null;
    updates['tiles'] = null;
    updates['approvals'] = null;
    updates['monsters'] = null;
    update(ref(db), updates).catch(console.error);
    alert('맵, 유저, 채팅 및 대기열 데이터가 완벽히 리셋되었습니다!');
  };

  useEffect(() => {
    const adminRef = ref(db, 'admin_config');
    onValue(adminRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        if (data.password) {
          setAdminPassword(data.password);
          setIsPasswordSet(true);
        } else {
          setIsPasswordSet(false);
        }
      } else {
        setIsPasswordSet(false);
      }
    });

    if (adminMode) {
      const approvalsRef = ref(db, 'approvals');
      const unsubscribeApprovals = onValue(approvalsRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const pending = Object.values(data).filter(u => u.status === 'pending');
          setPendingUsers(pending);
        } else {
          setPendingUsers([]);
        }
      });

      const playersRef = ref(db, 'players');
      const unsubscribePlayers = onValue(playersRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const active = Object.values(data);
          setActiveUsers(active);
        } else {
          setActiveUsers([]);
        }
      });

      return () => {
        unsubscribeApprovals();
        unsubscribePlayers();
      };
    }
  }, [adminMode]);

  useEffect(() => {
    if (user) {
      const userRef = ref(db, `approvals/${user.uid}`);
      const unsubscribe = onValue(userRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          if (user.status === 'pending' && data.status === 'approved') {
            setUser(prev => ({ ...prev, status: 'approved' }));
          }
        } else {
          setUser(null);
          if (user.status === 'approved') {
            alert("관리자에 의해 강제 퇴장되었습니다.");
            window.location.reload();
          } else {
            alert("접속이 거절되었습니다.");
            window.location.reload();
          }
        }
      });
      return () => unsubscribe();
    }
  }, [user]);

  const handleLogin = (e) => {
    e.preventDefault();
    const name = inputName.trim();
    if (!name) return;

    if (name === '관리자') {
      if (isPasswordSet) {
        setShowPasswordPrompt(true);
      } else {
        setAdminMode(true);
      }
      return;
    }

    if (usedColors.has(selectedColor)) {
      alert("이미 누군가 사용 중인 색상입니다. 다른 색상을 골라주세요.");
      return;
    }

    const uid = 'uid_' + Math.random().toString(36).substr(2, 9);
    const newUser = { uid, nickname: name, color: selectedColor, status: 'pending' };
    
    set(ref(db, `approvals/${uid}`), newUser)
      .then(() => {
        setUser(newUser);
      })
      .catch(err => console.error(err));
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (passwordInput === adminPassword) {
      setAdminMode(true);
      setShowPasswordPrompt(false);
      setPasswordInput('');
    } else {
      alert('비밀번호가 틀렸습니다.');
    }
  };

  const updateAdminPassword = () => {
    if (!newPassword.trim()) {
      alert('비밀번호를 입력하세요.');
      return;
    }
    update(ref(db, 'admin_config'), { password: newPassword.trim() })
      .then(() => {
        alert('관리자 비밀번호가 설정/변경되었습니다.');
        setNewPassword('');
      })
      .catch(console.error);
  };

  const approveUser = (uid) => {
    update(ref(db, `approvals/${uid}`), { status: 'approved' });
  };
  
  const rejectUser = (uid) => {
    remove(ref(db, `approvals/${uid}`));
  };

  const kickUser = (uid) => {
    if (window.confirm("정말 강퇴하시겠습니까?")) {
      remove(ref(db, `players/${uid}`));
      remove(ref(db, `approvals/${uid}`));
    }
  };

  const adminUser = { uid: 'admin_uid', nickname: '관리자', isAdmin: true, status: 'approved', color: '#ff0000' };

  if (adminMode) {
    return (
      <div id="root">
        <header className="app-header">
          <div className="app-title">
            <span>🛠️ 관리자 제어판</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>리셋까지 남은 시간</span>
              <strong style={{ fontSize: '1.1rem', letterSpacing: 1 }}>{timeLeft}</strong>
            </div>
            <button onClick={handleResetData} className="danger">즉시 리셋 💣</button>
            <button onClick={() => { setAdminMode(false); setInputName(''); }} className="secondary">로그아웃</button>
          </div>
        </header>

        <div className="main-container">
          <div className="game-area">
            <GameCanvas user={adminUser} isMobile={false} />
          </div>
          
          <aside className="sidebar">
            <div className="panel" style={{ flex: 'none' }}>
              <div className="panel-header">
                <span>비밀번호 관리</span>
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input 
                  type="password" 
                  placeholder="새 비밀번호" 
                  value={newPassword} 
                  onChange={e => setNewPassword(e.target.value)}
                />
                <button onClick={updateAdminPassword}>설정 저장</button>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {isPasswordSet ? '✅ 현재 비밀번호가 설정되어 있습니다.' : '⚠️ 비밀번호가 설정되지 않았습니다.'}
                </p>
              </div>
            </div>

            <div className="panel" style={{ flex: 1, minHeight: 0 }}>
              <div className="panel-header">
                <span>승인 대기 ({pendingUsers.length})</span>
              </div>
              <div style={{ padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingUsers.length === 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>대기중인 유저가 없습니다.</p>
                ) : (
                  pendingUsers.map(u => (
                    <div key={u.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '50%' }}>
                        <div style={{ width: 10, height: 10, background: u.color, borderRadius: '50%' }}></div>
                        <span style={{ fontWeight: '600', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nickname}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => approveUser(u.uid)} style={{ padding: '4px 8px', fontSize: '0.75rem' }}>승인</button>
                        <button onClick={() => rejectUser(u.uid)} className="danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }}>거절</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="panel" style={{ flex: 1, minHeight: 0 }}>
              <div className="panel-header" style={{ color: 'var(--success)' }}>
                <span>현재 접속자 ({activeUsers.length})</span>
              </div>
              <div style={{ padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activeUsers.length === 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>접속 중인 유저가 없습니다.</p>
                ) : (
                  activeUsers.map(u => (
                    <div key={u.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '60%' }}>
                        <div style={{ width: 10, height: 10, background: u.color, borderRadius: '50%', boxShadow: `0 0 5px ${u.color}` }}></div>
                        <span style={{ fontWeight: '600', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nickname}</span>
                      </div>
                      <button onClick={() => kickUser(u.uid)} className="danger" style={{ padding: '4px 8px', fontSize: '0.75rem', backgroundColor: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)' }}>강퇴</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  if (showPasswordPrompt) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-color)' }}>
        <form onSubmit={handlePasswordSubmit} className="panel" style={{ padding: 32, width: 340, gap: 24 }}>
          <h2 style={{ textAlign: 'center', fontWeight: 800 }}>관리자 인증</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input 
              type="password" 
              placeholder="비밀번호 입력" 
              value={passwordInput} 
              onChange={e => setPasswordInput(e.target.value)} 
              autoFocus 
            />
            <button type="submit" style={{ width: '100%' }}>입장하기</button>
            <button type="button" onClick={() => setShowPasswordPrompt(false)} className="secondary" style={{ width: '100%' }}>취소</button>
          </div>
        </form>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-color)' }}>
        <div className="panel" style={{ padding: 40, width: 440, gap: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: 8, background: 'linear-gradient(to right, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PIXEL WARS</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>픽셀로 영토를 확장하세요!</p>
          </div>
          
          <div className="device-toggle">
            <button 
              type="button" 
              className={!isMobile ? "active" : ""} 
              onClick={() => setIsMobile(false)}
            >
              💻 PC 최적화
            </button>
            <button 
              type="button" 
              className={isMobile ? "active" : ""} 
              onClick={() => setIsMobile(true)}
            >
              📱 모바일 최적화
            </button>
          </div>

          <div>
            <p style={{ fontSize: '0.85rem', marginBottom: '8px', color: 'var(--text-muted)' }}>캐릭터 색상 선택 (나만의 색상)</p>
            <div className="color-grid">
              {PALETTE_COLORS.map(color => {
                const isUsed = usedColors.has(color);
                const isSelected = selectedColor === color;
                return (
                  <div 
                    key={color}
                    className={`color-swatch ${isSelected ? 'selected' : ''} ${isUsed ? 'disabled' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => {
                      if (!isUsed) setSelectedColor(color);
                    }}
                    title={isUsed ? "사용중" : "선택 가능"}
                  >
                    {isUsed && <span style={{color: 'rgba(255,255,255,0.7)', fontSize: '1.2rem', fontWeight: 'bold'}}>&times;</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <input 
              type="text" 
              placeholder="닉네임 입력" 
              value={inputName} 
              onChange={e => setInputName(e.target.value)} 
              autoFocus 
            />
            <button type="submit" style={{ width: '100%', padding: 14, fontSize: '1rem' }}>
              접속 요청하기
            </button>
          </form>
          <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>관리자 승인 후 입장이 가능합니다.</p>
        </div>
      </div>
    );
  }

  if (user.status === 'pending') {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-color)' }}>
        <div className="panel" style={{ padding: 48, textAlign: 'center', width: 400, gap: 20 }}>
          <div className="loading-spinner" style={{ width: 40, height: 40, border: '4px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent)', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }}></div>
          <h2>승인 대기 중...</h2>
          <p style={{ color: 'var(--text-muted)' }}>관리자가 확인 중입니다. 잠시만 기다려주세요.</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div id="root">
      <header className="app-header">
        <div className="app-title">
          <div style={{ width: 24, height: 24, background: user.color, borderRadius: 4, boxShadow: `0 0 12px ${user.color}` }}></div>
          <span>PIXEL WARS</span>
        </div>
        
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.05)', padding: '6px 16px', borderRadius: 20, border: '1px solid var(--border-color)', visibility: isMobile ? 'hidden' : 'visible' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>리셋까지</span>
          <strong style={{ fontSize: '1rem', color: 'white', fontFamily: 'monospace' }}>{timeLeft}</strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {!isMobile && <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>접속 중: <strong>{user.nickname}</strong></span>}
          <button onClick={() => window.location.reload()} className="secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>로그아웃</button>
        </div>
      </header>

      <div className={`main-container ${isMobile ? 'mobile-view' : ''}`}>
        <div className="game-area">
          <GameCanvas user={user} isMobile={isMobile} />
        </div>
        
        <aside className="sidebar">
          <Chat user={user} />
        </aside>
      </div>
    </div>
  );
}

export default App;
