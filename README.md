My aliases, scripts and other stuff that make life easier.



### Quick way to make use of these dotfiles:

  Run this command:

    wget -O - https://raw.githubusercontent.com/lukosevicius/dotfiles/master/get-dotfiles | sudo bash

  If using BASH, than in dotfiles directory:

    ./bash-connect
    source ~/.bashrc

This replaces local .bashrc file with symlink to .bashrc from dotfiles, so proceed with caution.

In server it is good to change prompt color, so it wouldn't be mixed up with the local one. The command:

    change-env
