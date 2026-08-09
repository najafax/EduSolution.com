# EduSolution.com

A web application with a React frontend and a Node/Express + SQLite backend,
featuring email/password signup and login.

## Structure

- `frontend/` — React + Vite + Tailwind CSS SPA
- `backend/` — Express API with a SQLite database and JWT-based auth

## Getting started

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

The API runs on `http://localhost:4000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs on `http://localhost:5173` and proxies `/api` requests to the
backend.

See [CLAUDE.md](./CLAUDE.md) for a deeper look at the architecture and
conventions.
