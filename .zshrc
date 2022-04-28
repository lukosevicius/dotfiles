# Oh My Zsh
# =================================

export ZSH="/Users/mlukosevicius/.oh-my-zsh"
ZSH_THEME="powerlevel10k/powerlevel10k"

plugins=(git)
source $ZSH/oh-my-zsh.sh
POWERLEVEL10K_DISABLE_GITSTATUS=true




# Scripts and Alias
# =================================

function addToPATH {
  case ":$PATH:" in
    *":$1:"*) :;; # already there
    *) PATH="$1:$PATH";; # or PATH="$PATH:$1" 
  esac
}

# source all alias
for FILE in `find ~/dotfiles/alias`
do
  [ -f $FILE ] && source $FILE
done

# add all scripts to PATH
for FILE in `find ~/dotfiles/scripts`
do
  [ -f $FILE ] && addToPATH $FILE
done


# Other
# =================================

export VISUAL=vim
export EDITOR="$VISUAL"

# Get colors from this dir
# if [ -f ~/.dircolors ]; then
  # eval $(dircolors ~/.dircolors)
# fi

source ~/.nvm/nvm.sh

export PATH="/usr/local/opt/php:$PATH"

# colorize man pages

export LESS_TERMCAP_mb=$'\e[1;32m'
export LESS_TERMCAP_md=$'\e[1;32m'
export LESS_TERMCAP_me=$'\e[0m'
export LESS_TERMCAP_se=$'\e[0m'
export LESS_TERMCAP_so=$'\e[01;33m'
export LESS_TERMCAP_ue=$'\e[0m'
export LESS_TERMCAP_us=$'\e[1;4;31m'