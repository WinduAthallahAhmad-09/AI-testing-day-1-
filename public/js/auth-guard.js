if (!localStorage.getItem('token') && !window.location.pathname.includes('login.html')) {
    window.location.href = '/login.html';
}
document.addEventListener('DOMContentLoaded', () => {
    const userGreeting = document.getElementById('user-greeting');
    if (userGreeting) {
        userGreeting.innerText = 'Halo, ' + (localStorage.getItem('username') || 'User');
    }
});
