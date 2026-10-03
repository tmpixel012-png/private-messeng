import express from "express";
import http from "http";
import path from "path";
import crypto from "crypto";
import {fileURLToPath} from "url";
import pg from "pg";
import {Server} from "socket.io";

const {Pool} = pg;
const __filename=fileURLToPath(import.meta.url), __dirname=path.dirname(__filename);
const app=express(), server=http.createServer(app), io=new Server(server);
const pool=new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? {rejectUnauthorized:false} : false
});

const hashPassword=(password)=>{
  const salt=crypto.randomBytes(16).toString("hex");
  const hash=crypto.scryptSync(password,salt,64).toString("hex");
  return `${salt}:${hash}`;
};
const checkPassword=(password,stored)=>{
  try{
    const [salt,oldHash]=stored.split(":");
    const hash=crypto.scryptSync(password,salt,64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(oldHash,"hex"));
  }catch{return false;}
};
const token=()=>crypto.randomBytes(32).toString("hex");

async function init(){
  if(!process.env.DATABASE_URL){
    console.error("DATABASE_URL is missing. Connect this project to Supabase/PostgreSQL first.");
    process.exit(1);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions(
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      created BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages(
      id BIGSERIAL PRIMARY KEY,
      sender TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      receiver TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages(sender,receiver,id);
  `);
}

app.use(express.json({limit:"2mb"}));
app.use(express.static(__dirname));

async function auth(req,res,next){
  try{
    const t=req.headers.authorization?.replace("Bearer ","");
    if(!t)return res.status(401).json({error:"Необходимо войти"});
    const r=await pool.query("SELECT username FROM sessions WHERE token=$1",[t]);
    if(!r.rowCount)return res.status(401).json({error:"Сессия истекла. Войдите снова"});
    req.user=r.rows[0].username; req.token=t; next();
  }catch(e){console.error(e);res.status(500).json({error:"Ошибка сервера"});}
}

app.post("/api/register",async(req,res)=>{
  try{
    const username=String(req.body.username||"").trim();
    const password=String(req.body.password||"");
    if(!/^[a-zA-Zа-яА-ЯёЁ0-9 _-]{2,24}$/.test(username))return res.status(400).json({error:"Имя: 2–24 символа"});
    if(password.length<4)return res.status(400).json({error:"Пароль минимум 4 символа"});
    const exists=await pool.query("SELECT 1 FROM users WHERE username=$1",[username]);
    if(exists.rowCount)return res.status(409).json({error:"Такое имя уже занято"});
    await pool.query("INSERT INTO users(username,password,created) VALUES($1,$2,$3)",[username,hashPassword(password),Date.now()]);
    const t=token(); await pool.query("INSERT INTO sessions(token,username,created) VALUES($1,$2,$3)",[t,username,Date.now()]);
    res.json({token:t,username});
  }catch(e){console.error(e);res.status(500).json({error:"Не удалось создать аккаунт"});}
});

app.post("/api/login",async(req,res)=>{
  try{
    const username=String(req.body.username||"").trim(), password=String(req.body.password||"");
    const r=await pool.query("SELECT * FROM users WHERE username=$1",[username]);
    if(!r.rowCount||!checkPassword(password,r.rows[0].password))return res.status(401).json({error:"Неверное имя или пароль"});
    const t=token(); await pool.query("INSERT INTO sessions(token,username,created) VALUES($1,$2,$3)",[t,username,Date.now()]);
    res.json({token:t,username});
  }catch(e){console.error(e);res.status(500).json({error:"Ошибка входа"});}
});

app.post("/api/logout",auth,async(req,res)=>{
  await pool.query("DELETE FROM sessions WHERE token=$1",[req.token]);
  res.json({ok:true});
});

app.get("/api/users",auth,async(req,res)=>{
  try{const r=await pool.query("SELECT username FROM users WHERE username<>$1 ORDER BY username",[req.user]);res.json(r.rows)}catch(e){console.error(e);res.status(500).json({error:"Ошибка загрузки пользователей"})}
});

app.get("/api/messages/:with",auth,async(req,res)=>{
  try{
    const other=String(req.params.with);
    const r=await pool.query(`SELECT id,sender,receiver,body,created FROM messages WHERE (sender=$1 AND receiver=$2) OR (sender=$2 AND receiver=$1) ORDER BY id ASC LIMIT 300`,[req.user,other]);
    res.json(r.rows);
  }catch(e){console.error(e);res.status(500).json({error:"Ошибка загрузки сообщений"})}
});

app.post("/api/messages",auth,async(req,res)=>{
  try{
    const receiver=String(req.body.receiver||"").trim(), body=String(req.body.body||"").trim();
    if(!receiver||!body)return res.status(400).json({error:"Пустое сообщение"});
    if(body.length>4000)return res.status(400).json({error:"Слишком длинное сообщение"});
    const user=await pool.query("SELECT 1 FROM users WHERE username=$1",[receiver]);
    if(!user.rowCount)return res.status(404).json({error:"Пользователь не найден"});
    const created=Date.now();
    const r=await pool.query("INSERT INTO messages(sender,receiver,body,created) VALUES($1,$2,$3,$4) RETURNING id",[req.user,receiver,body,created]);
    const msg={id:r.rows[0].id,sender:req.user,receiver,body,created};
    io.to("user:"+receiver).emit("message",msg); io.to("user:"+req.user).emit("message",msg);
    res.json(msg);
  }catch(e){console.error(e);res.status(500).json({error:"Не удалось отправить сообщение"})}
});

io.on("connection",s=>s.on("identify",async t=>{
  try{const r=await pool.query("SELECT username FROM sessions WHERE token=$1",[t]);if(r.rowCount)s.join("user:"+r.rows[0].username)}catch(e){console.error(e)}
}));

app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));

const PORT=process.env.PORT||3000;
init().then(()=>server.listen(PORT,()=>console.log("Private Messeng started on "+PORT))).catch(e=>{console.error(e);process.exit(1)});
