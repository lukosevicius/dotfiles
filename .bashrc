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
# export PS1="\e[0;32m[\u@\h \W]\$ \e[m "

# ~/.bashrc: executed by bash(1) for non-login shells.
# see /usr/share/doc/bash/examples/startup-files (in the package bash-doc)
# for examples

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

# don't put duplicate lines or lines starting with space in the history.
# See bash(1) for more options
HISTCONTROL=ignoreboth

# append to the history file, don't overwrite it
shopt -s histappend

# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)
HISTSIZE=1000
HISTFILESIZE=2000

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

# If set, the pattern "**" used in a pathname expansion context will
# match all files and zero or more directories and subdirectories.
#shopt -s globstar

# make less more friendly for non-text input files, see lesspipe(1)
[ -x /usr/bin/lesspipe ] && eval "$(SHELL=/bin/sh lesspipe)"

# set variable identifying the chroot you work in (used in the prompt below)
if [ -z "${debian_chroot:-}" ] && [ -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi

# set a fancy prompt (non-color, unless we know we "want" color)
case "$TERM" in
    xterm-color|*-256color) color_prompt=yes;;
esac

if [ "$color_prompt" = yes ]; then
    PS1='${debian_chroot:+($debian_chroot)}\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
else
    PS1='${debian_chroot:+($debian_chroot)}\u@\h:\w\$ '
fi
unset color_prompt force_color_prompt

# If this is an xterm set the title to user@host:dir
case "$TERM" in
xterm*|rxvt*)
    PS1="\[\e]0;${debian_chroot:+($debian_chroot)}\u@\h: \w\a\]$PS1"
    ;;
*)
    ;;
esac