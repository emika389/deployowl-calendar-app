let activeUser = null;
let isSignupMode = false;
let currentDate = new Date(); // Start at today's date
let events = [];

// Check session on load
window.addEventListener('load', () => {
  const savedUser = localStorage.getItem('calendar_user');
  const savedPhoto = localStorage.getItem('calendar_user_photo');
  if (savedUser) {
    activeUser = JSON.parse(savedUser);
    if (savedPhoto) activeUser.photo = savedPhoto;
    showDashboard();
  }
});

function showToast(msg, statusType = 'primary') {
  const t = document.getElementById('toast');
  const tStatus = document.getElementById('toast-status');
  const tMsg = document.getElementById('toast-message');

  tMsg.textContent = msg;
  
  let color = 'var(--primary)';
  if (statusType === 'success') color = 'var(--success)';
  else if (statusType === 'error') color = 'var(--error)';
  
  tStatus.style.background = color;
  tStatus.style.color = color;
  
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
  }, 3000);
}

function toggleAuthMode() {
  isSignupMode = !isSignupMode;
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const nameGroup = document.getElementById('name-group');
  const btn = document.getElementById('auth-btn');
  const toggle = document.getElementById('toggle-text');

  if (isSignupMode) {
    title.textContent = 'Create Account';
    subtitle.textContent = 'Register instantly to your secure calendar';
    nameGroup.style.display = 'flex';
    btn.textContent = 'Sign Up';
    toggle.innerHTML = 'Already have an account? <span onclick="toggleAuthMode()">Sign in</span>';
  } else {
    title.textContent = 'Log in to Macro Calendar';
    subtitle.textContent = 'Secure login with your account credentials';
    nameGroup.style.display = 'none';
    btn.textContent = 'Sign In';
    toggle.innerHTML = `Don't have an account? <span onclick="toggleAuthMode()">Sign up</span>`;
  }
}

async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name').value;

  const action = isSignupMode ? 'signup' : 'login';
  const body = { email, password };
  if (isSignupMode) body.name = name;

  try {
    const response = await fetch(`/api/auth?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    if (isSignupMode) {
      showToast('Account registered successfully. Signing you in...', 'success');
      isSignupMode = false;
      toggleAuthMode();
      document.getElementById('auth-email').value = email;
      document.getElementById('auth-password').value = password;
    } else {
      showToast('Signed in successfully!', 'success');
      activeUser = { email: data.user.email, name: data.user.name, photo: data.user.photo };
      localStorage.setItem('calendar_user', JSON.stringify(activeUser));
      if (data.user.photo) {
        localStorage.setItem('calendar_user_photo', data.user.photo);
      } else {
        localStorage.removeItem('calendar_user_photo');
      }
      showDashboard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showDashboard() {
  document.getElementById('auth-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'block';
  document.getElementById('user-pill').style.display = 'flex';
  document.getElementById('user-display').textContent = activeUser.name || activeUser.email;
  
  const pImg = document.getElementById('profile-img');
  if (activeUser.photo) {
    pImg.src = activeUser.photo;
    pImg.style.display = 'block';
  } else {
    pImg.style.display = 'none';
  }

  fetchEvents();
  renderCalendar();
}

function logout() {
  localStorage.clear();
  activeUser = null;
  document.getElementById('auth-section').style.display = 'block';
  document.getElementById('dashboard-section').style.display = 'none';
  document.getElementById('user-pill').style.display = 'none';
  events = [];
  showToast('Logged out successfully.', 'success');
}

async function fetchEvents() {
  try {
    const res = await fetch(`/api/events?email=${encodeURIComponent(activeUser.email)}`);
    const data = await res.json();
    if (res.ok) {
      events = data.events;
      renderCalendar();
    }
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

function renderCalendar() {
  const monthTitle = document.getElementById('calendar-month-title');
  const grid = document.getElementById('calendar-grid');

  // Clear previous day cells (keep first 7 weekday labels)
  const dayCells = grid.querySelectorAll('.day-cell');
  dayCells.forEach(cell => cell.remove());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  monthTitle.textContent = `${months[month]} ${year}`;

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevTotalDays = new Date(year, month, 0).getDate();

  // Prev Month days filler
  for (let i = firstDayIndex; i > 0; i--) {
    const d = prevTotalDays - i + 1;
    const cell = createDayCell(d, true);
    grid.appendChild(cell);
  }

  // Current Month days
  const today = new Date();
  for (let d = 1; d <= totalDays; d++) {
    const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const cell = createDayCell(d, false, isToday);
    grid.appendChild(cell);
  }
}

function createDayCell(day, isOtherMonth, isToday) {
  const cell = document.createElement('div');
  cell.className = 'day-cell' + (isOtherMonth ? ' other-month' : '') + (isToday ? ' today' : '');
  
  const numSpan = document.createElement('span');
  numSpan.className = 'day-number';
  numSpan.textContent = day;
  cell.appendChild(numSpan);

  if (!isOtherMonth) {
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayEvents = events.filter(e => e.date === dateStr);

    cell.onclick = () => {
      if (dayEvents.length > 0) {
        openEventModal(dateStr, dayEvents[0]);
      } else {
        openEventModal(dateStr);
      }
    };

    const eventContainer = document.createElement('div');
    eventContainer.className = 'event-container';
    cell.appendChild(eventContainer);

    dayEvents.forEach(evt => {
      const badge = document.createElement('div');
      badge.className = 'event-badge';
      badge.textContent = evt.title;
      badge.title = evt.desc || '';
      eventContainer.appendChild(badge);
    });
  }

  return cell;
}

function navigateMonth(direction) {
  currentDate.setMonth(currentDate.getMonth() + direction);
  renderCalendar();
}

// Event Modal controls
function openEventModal(dateStr, event = null) {
  document.getElementById('event-date').value = dateStr;
  const deleteBtn = document.getElementById('event-delete-btn');

  if (event) {
    document.getElementById('event-modal-title').textContent = 'Event Details';
    document.getElementById('event-id').value = event.id;
    document.getElementById('event-title').value = event.title;
    document.getElementById('event-desc').value = event.desc || '';
    document.getElementById('event-attachment-url').value = event.attachmentUrl || '';
    deleteBtn.style.display = 'inline-block';
  } else {
    document.getElementById('event-modal-title').textContent = 'Create Calendar Event';
    document.getElementById('event-id').value = '';
    document.getElementById('event-title').value = '';
    document.getElementById('event-desc').value = '';
    document.getElementById('event-attachment-url').value = '';
    deleteBtn.style.display = 'none';
  }
  document.getElementById('event-modal-overlay').style.display = 'flex';
}

function closeEventModal() {
  document.getElementById('event-modal-overlay').style.display = 'none';
}

async function uploadEventAttachment(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  showToast('Uploading attachment...', 'primary');
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    document.getElementById('event-attachment-url').value = data.url;
    showToast('Attachment uploaded successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveEvent(e) {
  e.preventDefault();
  const date = document.getElementById('event-date').value;
  const id = document.getElementById('event-id').value;
  const title = document.getElementById('event-title').value;
  const desc = document.getElementById('event-desc').value;
  const attachmentUrl = document.getElementById('event-attachment-url').value;

  const eventPayload = { date, title, desc, attachmentUrl };
  if (id) {
    eventPayload.id = id;
  }

  const payload = {
    email: activeUser.email,
    event: eventPayload
  };

  try {
    const res = await fetch('/api/events?action=save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save event');

    events = data.events;
    renderCalendar();
    closeEventModal();
    showToast('Event saved successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteEvent() {
  const eventId = document.getElementById('event-id').value;
  if (!eventId) return;

  if (!confirm('Are you sure you want to delete this event?')) return;

  showToast('Deleting event...', 'primary');
  try {
    const res = await fetch('/api/events?action=delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: activeUser.email, eventId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete event');

    events = data.events;
    renderCalendar();
    closeEventModal();
    showToast('Event deleted successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Profile photo upload
async function uploadProfilePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('email', activeUser.email);

  showToast('Uploading photo...', 'primary');
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    activeUser.photo = data.url;
    localStorage.setItem('calendar_user_photo', data.url);
    localStorage.setItem('calendar_user', JSON.stringify(activeUser));
    
    const pImg = document.getElementById('profile-img');
    pImg.src = data.url;
    pImg.style.display = 'block';

    showToast('Profile photo updated successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Upgrade premium modal simulation
function openPremiumModal() {
  document.getElementById('premium-modal-overlay').style.display = 'flex';
}

function closePremiumModal() {
  document.getElementById('premium-modal-overlay').style.display = 'none';
}

async function confirmPremiumPayment() {
  showToast('Processing upgrade...', 'primary');
  try {
    const res = await fetch('/api/premium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: activeUser.email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upgrade failed');

    closePremiumModal();
    document.getElementById('premium-card').innerHTML = `
      <h4 class="card-title" style="color: var(--primary);">Premium Activated</h4>
      <p class="text-muted" style="font-size: 0.75rem;">You have unlocked the pro calendar yearly plan!</p>
    `;
    showToast('Subscription payment successful!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
