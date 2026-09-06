/* ============================================================
 *  支付系统接口（预留）
 * ------------------------------------------------------------
 * 目的：为「创建订单 / 支付 / 查询 / 退款」预留稳定的调用契约，
 * 便于后续接入真实支付网关（微信支付、支付宝、Stripe 等）而
 * 不改动业务调用方。
 *
 * 当前实现：localStorage 本地 mock，订单状态机为
 *   created → paid → (refunded)
 * 接入真实网关时，把 window.PayProvider 替换为服务端实现，
 * 业务侧仍调用 Pay.createOrder / Pay.pay / Pay.query / Pay.refund。
 *
 * 注意：localStorage 惰性访问，模块加载时不触碰存储，
 * node / 测试环境 require 本文件不会报错。
 * ============================================================ */
(function (global) {
  'use strict';

  const store = {
    ordersKey: 'lpt_orders',
    _ls() {
      try { return global.localStorage; } catch (e) { return null; }
    },
    list() {
      const ls = this._ls();
      if (!ls) return [];
      try { const v = ls.getItem(this.ordersKey); return v ? JSON.parse(v) : []; }
      catch (e) { return []; }
    },
    save(arr) {
      const ls = this._ls();
      if (!ls) return;
      try { ls.setItem(this.ordersKey, JSON.stringify(arr)); } catch (e) { /* ignore */ }
    }
  };

  function findOrder(orderId) {
    const o = store.list().find(x => x.id === orderId);
    if (!o) throw new Error('订单不存在');
    return o;
  }

  const Pay = {
    /**
     * 创建订单
     * @param {{items:Array<{sku?,name,price,qty}>, userId?:string, remark?:string}} payload
     * @returns {Promise<order>}
     */
    async createOrder(payload) {
      const { items, userId, remark } = payload || {};
      if (!items || !items.length) throw new Error('订单商品不能为空');
      let total = 0;
      items.forEach(it => { total += (Number(it.price) || 0) * (Number(it.qty) || 0); });
      const order = {
        id: 'o_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        items, userId: userId || null, remark: remark || '',
        total, status: 'created', createdAt: Date.now()
      };
      const all = store.list(); all.push(order); store.save(all);
      return order;
    },

    /**
     * 支付（mock 直接置 paid）
     * @param {{orderId:string, method?:string}} payload
     * @returns {Promise<{ok:true,order}>}
     */
    async pay(payload) {
      const { orderId, method } = payload || {};
      const o = findOrder(orderId);
      o.status = 'paid'; o.paidAt = Date.now(); o.method = method || 'mock';
      store.save(store.list().map(x => x.id === o.id ? o : x));
      return { ok: true, order: o };
    },

    /** 查询订单状态 */
    async query(payload) {
      const { orderId } = payload || {};
      return findOrder(orderId);
    },

    /**
     * 退款（仅已支付订单可退）
     * @param {{orderId:string, reason?:string}} payload
     * @returns {Promise<{ok:true,order}>}
     */
    async refund(payload) {
      const { orderId, reason } = payload || {};
      const o = findOrder(orderId);
      if (o.status !== 'paid') throw new Error('仅已支付订单可退款');
      o.status = 'refunded'; o.refundAt = Date.now(); o.refundReason = reason || '';
      store.save(store.list().map(x => x.id === o.id ? o : x));
      return { ok: true, order: o };
    }
  };

  global.Pay = Pay;
  // 预留：真实支付网关实现挂到 window.PayProvider 即可在此委托（留接口位，暂不启用）
  // global.PayProvider = { createOrder, pay, query, refund };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
