# Death Pinball 구현 원리 (Implementation Principles)

이 문서는 '4인용 실시간 핀볼 내기 게임 (Death Pinball)'의 기술적 아키텍처와 핵심 구현 원리를 설명합니다.

## 1. 기술 스택 (Tech Stack)

- **Framework**: Next.js 14 (App Router, TypeScript)
- **Styling**: Tailwind CSS
- **Physics Engine**: Matter.js (2D 물리 엔진)
- **Realtime Infrastructure**: Supabase Realtime (WebSocket)
- **RNG Synchronization**: `seedrandom` (시드 기반 난수 생성)

---

## 2. 핵심 아키텍처: 결정론적 시뮬레이션 (Deterministic Simulation)

멀티플레이어 물리 게임에서 가장 큰 문제는 **"모든 플레이어의 화면에서 똑같은 물리 현상이 일어나게 하는 것"**입니다. 네트워크로 공의 좌표(x, y)를 실시간으로 전송하면 렉(Lag)이 발생하고 끊겨 보입니다.

이를 해결하기 위해 **시드 동기화(Seed Synchronization)** 방식을 사용했습니다.

### 원리
1. **시드(Seed) 생성**: 게임 시작 시, **호스트(방장)**가 무작위 문자열(Seed)을 생성합니다. (예: `"game-seed-123"`)
2. **시드 공유**: 호스트는 이 시드를 Supabase를 통해 모든 게스트에게 전송합니다.
3. **난수 생성기 초기화**: 모든 클라이언트는 `seedrandom(seed)` 라이브러리를 사용하여 **동일한 시드**로 난수 생성기를 초기화합니다.
4. **결과**: `rng()`를 호출할 때마다 모든 기기에서 **완벽하게 동일한 순서의 난수**가 나옵니다.
    - 공의 초기 흔들림 (Jitter)
    - 공의 낙하 위치
    - 프로펠러의 회전 방향

이로 인해 각자의 브라우저에서 물리 엔진을 따로 돌려도, **마치 같은 영상을 보는 것처럼 똑같은 시뮬레이션 결과**가 나옵니다.

---

## 3. 승자 판정: 호스트 권한 (Host Authority)

브라우저(Chrome, Safari 등)나 OS, CPU 아키텍처에 따라 부동소수점 연산(Floating Point Math)에 미세한 오차가 발생할 수 있습니다. 이를 방지하기 위해 **호스트 권한 모델**을 적용했습니다.

1. **시뮬레이션**: 모든 클라이언트(호스트+게스트)가 시각적 연출을 위해 물리 엔진을 실행합니다.
2. **승자 감지**: 
    - **게스트**: 공이 바닥에 닿아도 로컬에서 승자를 확정하지 않고 대기합니다.
    - **호스트**: 공이 바닥에 닿으면 승자를 확정하고, `game_winner` 이벤트를 브로드캐스트합니다.
3. **결과 동기화**: 게스트는 호스트가 보낸 `game_winner` 메시지를 수신하는 즉시, 자신의 시뮬레이션 상태와 관계없이 해당 플레이어를 승자로 표시합니다.

> **Why?** 호스트의 화면이 곧 **"서버의 진실(Server Truth)"**이 되므로, 절대 판정이 엇갈리지 않습니다.

---

## 4. 실시간 통신 흐름 (Supabase Realtime)

Supabase의 `Broadcast` 기능을 사용하여 서버리스(Serverless) 방식으로 상태를 동기화합니다.

### 주요 이벤트 (Channel: `room:{roomId}`)

| 이벤트 명 | 발신자 | 내용 | 설명 |
| :--- | :--- | :--- | :--- |
| `join_request` | 게스트 | `{ player }` | 게스트가 입장했음을 알림 |
| `update_players` | 호스트 | `{ players[] }` | 최신 참가자 목록을 모두에게 전송 (방장이 관리) |
| `ready_change` | 누구나 | `{ id, isReady }` | 준비 상태 변경 알림 |
| `start_game` | 호스트 | `{ players, seed }` | 게임 시작 신호 및 **난수 시드** 전송 |
| `game_winner` | 호스트 | `{ winnerId }` | 최종 승자 ID 통보 (게임 종료) |
| `restart_game` | 호스트 | `{}` | 게임 재시작 신호 |

---

## 5. 물리 엔진 튜닝 (Physics Tuning)

게임의 재미를 위해 물리 엔진(`Matter.js`)을 다음과 같이 튜닝했습니다.

- **저중력 (Low Gravity)**: `engine.gravity.y = 0.17` (기본값 1.0)
    - 공이 천천히 떨어지며 긴장감을 줍니다.
- **높은 반발력 (High Restitution)**: `restitution = 0.95`
    - 공끼리 부딪혔을 때 에너지를 잃지 않고 탱탱하게 튕겨 나갑니다.
- **공 크기 확대**: 반지름 `16px`
    - 충돌 빈도를 높여 상호작용을 극대화했습니다.
- **프로펠러 (Propellers)**:
    - 5개의 프로펠러가 시드에 의해 결정된 랜덤 방향으로 회전하며 변수를 만듭니다.

---

## 6. 요약

이 프로젝트는 별도의 게임 서버(Node.js/Unity 등) 없이, **프론트엔드 기술과 경량화된 실시간 DB(Supabase)**만으로 멀티플레이어 게임을 구현한 사례입니다. **시드 동기화**를 통해 데이터를 최소화하면서도 완벽한 동기화를 이루어냈습니다.
