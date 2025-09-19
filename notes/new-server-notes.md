# Create new user "mantas" one-liner:
adduser --gecos GECOS mantas && usermod -aG sudo mantas && rsync --archive --chown=mantas:mantas ~/.ssh /home/mantas && su - mantas
# Git clone my dotfiles:
wget --no-cache -O - https://raw.githubusercontent.com/lukosevicius/dotfiles/main/get-dotfiles | bash