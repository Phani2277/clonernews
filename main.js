const API_BASE = 'https://hacker-news.firebaseio.com/v0';
let currentType = 'stories';
let ids = [];
let index = 0;
const batchSize = 10;
const postsContainer = document.getElementById('posts');
const liveContainer = document.getElementById('live');
const errorContainer = document.getElementById('error');
const sentinel = document.getElementById('sentinel');
const searchInput = document.getElementById('search');
const itemCache = new Map();

function showError(msg) {
  errorContainer.textContent = msg;
  errorContainer.classList.remove('hidden');
}

function clearError() {
  errorContainer.textContent = '';
  errorContainer.classList.add('hidden');
}

async function fetchIds(type) {
  try {
    const endpoint = type === 'jobs' ? 'jobstories' : 'newstories';
    const res = await fetch(`${API_BASE}/${endpoint}.json`);
    if (!res.ok) throw new Error('Failed to fetch IDs');
    return await res.json();
  } catch (err) {
    console.error(err);
    showError('Unable to load posts.');
    return [];
  }
}

async function fetchItem(id) {
  if (itemCache.has(id)) return itemCache.get(id);
  try {
    const res = await fetch(`${API_BASE}/item/${id}.json`);
    if (!res.ok) throw new Error('Failed to fetch item');
    const data = await res.json();
    itemCache.set(id, data);
    return data;
  } catch (err) {
    console.error(err);
    showError('Unable to load item.');
    return null;
  }
}

function clearPosts() {
  postsContainer.innerHTML = '';
  ids = [];
  index = 0;
}

async function loadType(type) {
  currentType = type;
  clearPosts();
  clearError();
  ids = await fetchIds(type);
  await loadMore();
}

async function loadMore() {
  try {
    if (currentType === 'polls') {
      let added = 0;
      let start = index;
      while (start < ids.length && added === 0) {
        const slice = ids.slice(start, start + batchSize);
        const items = await Promise.all(slice.map(fetchItem));
        const polls = items.filter(item => item && item.type === 'poll');
        polls.sort((a, b) => b.time - a.time);
        for (const poll of polls) {
          await renderPost(poll);
        }
        added += polls.length;
        start += batchSize;
      }
      index = start;
      if (added === 0) {
        const msg = document.createElement('p');
        msg.textContent = 'No polls available.';
        postsContainer.appendChild(msg);
      }
      return;
    }

    const slice = ids.slice(index, index + batchSize);
    const items = await Promise.all(slice.map(fetchItem));
    const filtered = items.filter(item => {
      if (!item) return false;
      if (currentType === 'stories') return item.type === 'story';
      if (currentType === 'jobs') return item.type === 'job';
      return false;
    });
    filtered.sort((a, b) => b.time - a.time);
    for (const item of filtered) {
      await renderPost(item);
    }
    index += batchSize;
  } catch (err) {
    console.error(err);
    showError('Failed to load more posts.');
  }
}

async function renderPost(post) {
  const div = document.createElement('div');
  div.className = 'post';
  const link = post.url || `https://news.ycombinator.com/item?id=${post.id}`;
  let optionsHTML = '';
  if (post.type === 'poll' && post.parts) {
    const options = await Promise.all(post.parts.map(fetchItem));
    const list = options.map(opt => `<li>${opt.text} (${opt.score || 0})</li>`).join('');
    optionsHTML = `<ul class="poll-options">${list}</ul>`;
  }
  div.innerHTML = `<h3><a href="${link}" target="_blank">${post.title}</a></h3>` +
    optionsHTML +
    `<small>${new Date(post.time * 1000).toLocaleString()} | ${post.descendants || 0} comments</small>` +
    `<button class="show-comments">Comments</button>` +
    `<div class="comments"></div>`;
  const btn = div.querySelector('.show-comments');
  btn.addEventListener('click', () => {
    const container = div.querySelector('.comments');
    if (container.childElementCount > 0) {
      container.innerHTML = '';
      return;
    }
    if (post.kids) {
      renderComments(post.kids, container);
    }
  });
  postsContainer.appendChild(div);
}

async function renderComments(kids, container) {
  const comments = await Promise.all(kids.map(fetchItem));
  comments.sort((a, b) => b.time - a.time);
  comments.forEach(comment => {
    if (!comment || comment.deleted) return;
    const div = document.createElement('div');
    div.className = 'comment';
    div.innerHTML = `<p>${comment.text || ''}</p>` +
      `<small>${new Date(comment.time * 1000).toLocaleString()}</small>`;
    container.appendChild(div);
    if (comment.kids) {
      const child = document.createElement('div');
      child.className = 'comments';
      div.appendChild(child);
      renderComments(comment.kids, child);
    }
  });
}

async function searchPosts(query) {
  if (!query) {
    loadType(currentType);
    return;
  }
  try {
    clearError();
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search request failed');
    const data = await res.json();
    postsContainer.innerHTML = '';
    data.hits.sort((a, b) => b.created_at_i - a.created_at_i);
    data.hits.forEach(hit => {
      const link = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const div = document.createElement('div');
      div.className = 'post';
      div.innerHTML = `<h3><a href="${link}" target="_blank">${hit.title}</a></h3>`;
      postsContainer.appendChild(div);
    });
  } catch (err) {
    console.error(err);
    showError('Search failed.');
  }
}

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

function throttle(fn, limit) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

const throttledLoadMore = throttle(loadMore, 1000);

document.getElementById('loadMore').addEventListener('click', throttledLoadMore);

window.addEventListener('scroll', throttle(() => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
    throttledLoadMore();
  }
}, 200));

if (sentinel) {
  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      throttledLoadMore();
    }
  });
  observer.observe(sentinel);
}

const debouncedSearch = debounce(e => searchPosts(e.target.value), 300);
searchInput.addEventListener('input', debouncedSearch);

Array.from(document.querySelectorAll('nav button')).forEach(btn =>
  btn.addEventListener('click', () => loadType(btn.dataset.type))
);

loadType('stories');

async function checkForUpdates() {
  try {
    const newIds = await fetchIds(currentType);
    const diff = newIds.filter(id => !ids.includes(id));
    if (diff.length > 0) {
      liveContainer.textContent = `${diff.length} new posts available. Click to refresh.`;
      liveContainer.classList.remove('hidden');
      liveContainer.onclick = () => {
        loadType(currentType);
        liveContainer.classList.add('hidden');
      };
    }
  } catch (err) {
    console.error(err);
  }
}
setInterval(checkForUpdates, 5000);
