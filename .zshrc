# Oh My Zsh
# =================================

export ZSH="/Users/mlukosevicius/.oh-my-zsh"
ZSH_THEME="powerlevel10k/powerlevel10k"

plugins=(git)
source $ZSH/oh-my-zsh.sh

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