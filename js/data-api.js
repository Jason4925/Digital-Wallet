// async function request(path, options = {}) {
//   let response;
//   try {
//     response = await fetch(path, {
//       ...options,
//       credentials: "same-origin",
//       headers: { "Content-Type": "application/json", ...(options.headers || {}) }
//     });
//   } catch {
//     return { data: null, error: { code: "NETWORK_ERROR", message: "The wallet server could not be reached." } };
//   }

//   let result;
//   try {
//     result = await response.json();
//   } catch {
//     return { data: null, error: { code: "INVALID_RESPONSE", message: "The wallet server returned an invalid response." } };
//   }

//   if (!response.ok && !result.error) {
//     result.error = { code: `HTTP_${response.status}`, message: "The wallet request could not be completed." };
//   }
//   return result;
// }

// const db = {
//   auth: {
//     getSession: () => request("/api/auth/session", { method: "GET", headers: {} }),
//     signInWithPassword: ({ email, password }) => request("/api/auth/signin", {
//       method: "POST",
//       body: JSON.stringify({ email, password })
//     }),
//     signUp: ({ email, password, options = {} }) => request("/api/auth/signup", {
//       method: "POST",
//       body: JSON.stringify({ email, password, full_name: options.data?.full_name })
//     }),
//     signOut: () => request("/api/auth/signout", { method: "POST" })
//   },
//   get: (table, query = {}) => request("/api/data/query", {
//     method: "POST",
//     body: JSON.stringify({ table, ...query })
//   }),
//   insert: (table, row) => request("/api/data/mutate", {
//     method: "POST",
//     body: JSON.stringify({ table, action: "insert", rows: row })
//   }),
//   update: (table, values, filters = []) => request("/api/data/mutate", {
//     method: "POST",
//     body: JSON.stringify({ table, action: "update", values, filters })
//   }),
//   delete: (table, filters = []) => request("/api/data/mutate", {
//     method: "POST",
//     body: JSON.stringify({ table, action: "delete", filters })
//   }),
//   upsert: (table, row) => request("/api/data/mutate", {
//     method: "POST",
//     body: JSON.stringify({ table, action: "upsert", row })
//   }),
//   rpc: (name, params = {}) => request("/api/rpc", {
//     method: "POST",
//     body: JSON.stringify({ name, params })
//   })
// };

// export { db };


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
