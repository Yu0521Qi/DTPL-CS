/* ============================================================
 *  账号系统接口（预留）
 * ------------------------------------------------------------
 * 目的：为「注册 / 登录 / 会话」预留稳定的调用契约，便于后续接入
 * 真实后端（自有服务、微信开放平台、Auth0 等）而不改动业务调用方。
 *
 * 当前实现：localStorage 本地 mock，可离线演示、可单测。
 * 接入真实后端时，只需把 window.AuthProvider 替换为服务端实现，
 * 业务侧仍调用 Auth.register / Auth.login / Auth.logout /
 * Auth.currentUser / Auth.isLoggedIn，无需改动任何调用点。
 *
 * 注意：localStorage 为惰性访问，模块加载时不会触碰存储，
 * 因此在 node / 测试环境中 require 本文件不会报错。
 * ============================================================ */
(function (global) {
  'use strict';

  // —— 底层存储（可替换）——
  const store = {
    usersKey: 'lpt_users',
    sessionKey: 'lpt_session',
    _ls() {
      try { return global.localStorage; } catch (e) { return null; }
    },
    _read(key, fallback) {
      const ls = this._ls();
      if (!ls) return fallback;
      try { const v = ls.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    _write(key, val) {
      const ls = this._ls();
      if (!ls) return;
      try { ls.setItem(key, JSON.stringify(val)); } catch (e) { /* 配额/隐私模式忽略 */ }
    },
    listUsers() { return this._read(this.usersKey, []); },
    saveUsers(u) { this._write(this.usersKey, u); },
    getSession() { return this._read(this.sessionKey, null); },
    setSession(s) {
      const ls = this._ls();
      if (!ls) return;
      try { s ? ls.setItem(this.sessionKey, JSON.stringify(s)) : ls.removeItem(this.sessionKey); }
      catch (e) { /* ignore */ }
    }
  };

  // 业务侧调用的账号接口（契约稳定，签名不要随意改）
  const Auth = {
    /**
     * 注册
     * @param {{name:string,email:string,password:string}} payload
     * @returns {Promise<{ok:true,user:{id,name,email,loginAt}}>}
     */
    async register(payload) {
      const { name, email, password } = payload || {};
      if (!name || !email || !password) throw new Error('姓名、邮箱、密码均为必填');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('邮箱格式不正确');
      const users = store.listUsers();
      if (users.some(u => u.email === email)) throw new Error('该邮箱已注册');
      const user = {
        id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name, email, password, createdAt: Date.now()
      };
      users.push(user);
      store.saveUsers(users);
      const session = { id: user.id, name: user.name, email: user.email, loginAt: Date.now() };
      store.setSession(session);
      return { ok: true, user: session };
    },

    /**
     * 登录
     * @param {{email:string,password:string}} payload
     * @returns {Promise<{ok:true,user:{id,name,email,loginAt}}>}
     */
    async login(payload) {
      const { email, password } = payload || {};
      if (!email || !password) throw new Error('邮箱与密码必填');
      const user = store.listUsers().find(u => u.email === email && u.password === password);
      if (!user) throw new Error('邮箱或密码错误');
      const session = { id: user.id, name: user.name, email: user.email, loginAt: Date.now() };
      store.setSession(session);
      return { ok: true, user: session };
    },

    /** 登出 */
    async logout() { store.setSession(null); return { ok: true }; },

    /** 当前登录用户，未登录返回 null */
    currentUser() { return store.getSession(); },

    /** 是否已登录 */
    isLoggedIn() { return !!store.getSession(); }
  };

  // 对外暴露稳定接口
  global.Auth = Auth;
  // 预留：真实后端实现挂到 window.AuthProvider 即可在此委托（留接口位，暂不启用）
  // global.AuthProvider = { register, login, logout, currentUser, isLoggedIn };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
