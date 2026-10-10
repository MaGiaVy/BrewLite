# BrewLite

Ứng dụng đặt và thanh toán đồ uống không dùng tiền mặt.

## Tech Stack
- **Frontend:** Next.js (TypeScript, TailwindCSS)
- **Backend:** NestJS (TypeScript, REST API)
- **Database:** PostgreSQL + Prisma
- **Payment:** Mock Payment Service

## Cách chạy dự án

### Yêu cầu
- Node.js >= 18
- PostgreSQL đang chạy

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run start:dev
```
API chạy tại: http://localhost:3001


### Frontend
```bash
cd frontend
npm install
npm run dev
```
App chạy tại: http://localhost:3000


---

### 3. 🗂️ Khởi tạo Git repository

Mở terminal tại thư mục gốc `BrewLite/` rồi chạy từng lệnh:

```bash
git init
git add .
git commit -m "task 1: khởi tạo monorepo Next.js + NestJS, README, .env.example"