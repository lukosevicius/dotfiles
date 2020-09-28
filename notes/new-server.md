# Create new user "mantas" one-liner:
adduser --gecos GECOS mantas && usermod -aG sudo mantas && rsync --archive --chown=mantas:mantas ~/.ssh /home/mantas && su - mantas
# Git clone my dotfiles:
wget --no-cache -O - https://raw.githubusercontent.com/lukosevicius/dotfiles/master/scripts/setup/dots | bash
# Add to sudo path:
:/home/mantas/dotfiles:/home/mantas/dotfiles/scripts:/home/mantas/dotfiles/scripts/helpers:/home/mantas/dotfiles/scripts/server:/home/mantas/dotfiles/scripts/setup