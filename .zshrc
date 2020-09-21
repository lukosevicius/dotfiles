
# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH=$HOME/.oh-my-zsh

# Theme
ZSH_THEME="agnoster"

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
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

if [ -d "$HOME/dotfiles/scripts/helpers" ] ; then
    addToPATH $HOME/dotfiles/scripts/helpers
fi

# source all dotfiles (alias, functinos)
for DOTFILE in `find ~/dotfiles/alias`
do
  [ -f $DOTFILE ] && source $DOTFILE
done

export VISUAL=vim
export EDITOR="$VISUAL"