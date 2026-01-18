const API_URL = window.location.origin;

document.addEventListener('DOMContentLoaded', () => {
    const createMeetingBtn = document.getElementById('createMeetingBtn');
    const meetingLinkContainer = document.getElementById('meetingLinkContainer');
    const meetingLinkInput = document.getElementById('meetingLink');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const joinMeetingBtn = document.getElementById('joinMeetingBtn');

    createMeetingBtn.addEventListener('click', async () => {
        try {
            createMeetingBtn.disabled = true;
            createMeetingBtn.textContent = 'Creating...';

            const response = await fetch(`${API_URL}/api/create-meeting`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (data.success) {
                const fullUrl = `${window.location.origin}${data.meeting_url}`;
                meetingLinkInput.value = fullUrl;
                meetingLinkContainer.style.display = 'block';
                createMeetingBtn.style.display = 'none';

                showNotification('Meeting created successfully!', 'success');

                joinMeetingBtn.onclick = () => {
                    window.location.href = data.meeting_url;
                };
            } else {
                showNotification('Failed to create meeting', 'error');
                createMeetingBtn.disabled = false;
                createMeetingBtn.innerHTML = '<span class="btn-icon">+</span> Generate Meeting Link';
            }
        } catch (error) {
            console.error('Error creating meeting:', error);
            showNotification('Error creating meeting', 'error');
            createMeetingBtn.disabled = false;
            createMeetingBtn.innerHTML = '<span class="btn-icon">+</span> Generate Meeting Link';
        }
    });

    copyLinkBtn.addEventListener('click', () => {
        meetingLinkInput.select();
        document.execCommand('copy');
        
        const originalText = copyLinkBtn.textContent;
        copyLinkBtn.textContent = 'Copied!';
        
        setTimeout(() => {
            copyLinkBtn.textContent = originalText;
        }, 2000);

        showNotification('Link copied to clipboard!', 'success');
    });
});

function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}