export ZSH="/Users/mlukosevicius/.oh-my-zsh"
ZSH_THEME="powerlevel10k/powerlevel10k"

plugins=(git)

source $ZSH/oh-my-zsh.sh


function addToPATH {
  case ":$PATH:" in
    *":$1:"*) :;; # already there
    *) PATH="$1:$PATH";; # or PATH="$PATH:$1" 
  esac
}

# add dotfile's scripts to PATH
if [ -d "$HOME/dotfiles" ] ; then
    addToPATH $HOME/dot
fi

if [ -d "$HOME/dotfiles/scripts" ] ; then
    addToPATH $HOME/dotfiles/scripts
fi

if [ -d "$HOME/dotfiles/scripts/setup" ] ; then
    addToPATH $HOME/dotfiles/scripts/setup
fi

if [ -d "$HOME/dotfiles/scripts/server" ] ; then
    addToPATH $HOME/dotfiles/scripts/server
fi

if [ -d "$HOME/dotfiles/scripts/helpers" ] ; then
    addToPATH $HOME/dotfiles/scripts/helpers
fi

if [ -d "$HOME/dotfiles/scripts/tmp" ] ; then
    addToPATH $HOME/dotfiles/scripts/tmp
fi

# source all dotfiles (alias, functinos)
for DOTFILE in `find ~/dotfiles/alias`
do
  [ -f $DOTFILE ] && source $DOTFILE
done

export VISUAL=vim
export EDITOR="$VISUAL"

# Get colors from this dir
# if [ -f ~/.dircolors ]; then
  # eval $(dircolors ~/.dircolors)
# fi

source ~/.nvm/nvm.sh

export PATH="/usr/local/opt/php:$PATH"