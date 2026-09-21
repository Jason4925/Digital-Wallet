async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = body?.error || {};
    return {
      data: body?.data ?? null,
      error: {
        code: error.code || `HTTP_${response.status}`,
        message: error.message || "The request could not be completed."
      }
    };
  }

  return { data: body?.data ?? body, error: null };
}

const auth = {
  async getSession() {
    return request("/api/auth/session", { method: "GET", headers: {} });
  },
  async signUp({ email, password, options = {} }) {
    return request("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        full_name: options.data?.full_name || ""
      })
    });
  },
  async signInWithPassword({ email, password }) {
    return request("/api/auth/signin", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  async signOut() {
    return request("/api/auth/signout", { method: "POST", body: "{}" });
  }
};

async function get(table, { filters = [], any = [], sorts = [], limit = null, single = false } = {}) {
  return request("/api/data/query", {
    method: "POST",
    body: JSON.stringify({ table, filters, any, sorts, limit, single })
  });
}

async function insert(table, rows) {
  return request("/api/data/mutate", {
    method: "POST",
    body: JSON.stringify({ action: "insert", table, rows })
  });
}

async function update(table, values, filters = []) {
  return request("/api/data/mutate", {
    method: "POST",
    body: JSON.stringify({ action: "update", table, values, filters })
  });
}

async function upsert(table, row, conflictKeys = []) {
  return request("/api/data/mutate", {
    method: "POST",
    body: JSON.stringify({ action: "upsert", table, row, conflictKeys })
  });
}

async function remove(table, filters = []) {
  return request("/api/data/mutate", {
    method: "POST",
    body: JSON.stringify({ action: "delete", table, filters })
  });
}

async function rpc(name, params = {}) {
  return request("/api/rpc", {
    method: "POST",
    body: JSON.stringify({ name, params })
  });
}

export const db = {
  auth,
  get,
  insert,
  update,
  upsert,
  delete: remove,
  rpc
};
