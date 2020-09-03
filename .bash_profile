# if running bash
# if [ -n "$BASH_VERSION" ]; then
#     # include .bashrc if it exists
#     if [ -f "$HOME/.bashrc" ]; then
#         . "$HOME/.bashrc"
#     fi
# fi

# put this to .bashrc
# if [ -f ~/dotfiles/.bash_profile ]; then
#     . ~/dotfiles/.bash_profile
# fi

# set PATH so it includes user's private bin if it exists
# if [ -d "$HOME/bin" ] ; then
#     PATH="$HOME/bin:$PATH"
# fi

# # set PATH so it includes user's private bin if it euser=surio1xists
# if [ -d "$HOME/.local/bin" ] ; then
#     PATH="$HOME/.local/bin:$PATH"
# fi

# # dotfiles automation scripts
# if [ -d "$HOME/dotfiles/" ] ; then
#   PATH="$HOME/dotfiles/:$PATH"
# fi


# dotfiles automation scripts
if [ -d "$HOME/dotfiles/scripts" ] ; then
  PATH="$HOME/dotfiles/scripts:$PATH"
fi

# dotfiles automation scripts
if [ -d "$HOME/dotfiles/scripts/setup" ] ; then
  PATH="$HOME/dotfiles/scripts/setup:$PATH"
fi

# # dotfiles automation scripts
# if [ -d "$HOME/dotfiles/bin" ] ; then
#   PATH="$HOME/dotfiles/bin:$PATH"
# fi


# Python
if [ -d "$HOME/py" ] ; then
  # main python dir
  PATH="$HOME/py:$PATH"
  # other python dirs
  for py_dir in `find ~/dotfiles/system`
  do
    PATH="$HOME/$py_dir:$PATH"
  done
fi

# source all dotfiles (alias, functinos)
for DOTFILE in `find ~/dotfiles/alias`
do
  [ -f $DOTFILE ] && source $DOTFILE
done


# From default Ubuntu .bashrc

# enable color support of ls and also add handy aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    #alias dir='dir --color=auto'
    #alias vdir='vdir --color=auto'

    alias grep='grep --color=auto'
    alias fgrep='fgrep --color=auto'
    alias egrep='egrep --color=auto'
fi

# colors:
export PS1="\e[0;32m[\u@\h \W]\$ \e[m "