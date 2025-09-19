# Oh My Zsh
# =================================

export ZSH="/Users/mantas/.oh-my-zsh"
ZSH_THEME="powerlevel10k/powerlevel10k"
# ZSH_THEME="robbyrussell"
# ZSH_THEME="agnoster"

plugins=(
  git
)
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

# source git alias
source ~/dotfiles/git/.alias

# add all scripts to PATH
export PATH=$PATH:/Users/mantas/Library/Python/3.9/bin
export PATH=$PATH:/Users/mantas/dotfiles/scripts
export PATH=$PATH:/Users/mantas/dotfiles/scripts/git
export PATH=$PATH:/Users/mantas/dotfiles/scripts/wordpress
export PATH=$PATH:/Users/mantas/dotfiles/private
export PATH=$PATH:/Users/mantas/dotfiles/git

# for FILE in `find ~/dotfiles/scripts`
# do
#   [ -f $FILE ] && addToPATH $FILE
# done


# Other
# =================================

export VISUAL=vim
export EDITOR="$VISUAL"

# Get colors from this dir
# if [ -f ~/.dircolors ]; then
  # eval $(dircolors ~/.dircolors)
# fi

# source ~/.nvm/nvm.sh
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"  # This loads nvm
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"  # This loads nvm bash_completion

export PATH="/usr/local/opt/php:$PATH"

# colorize man pages

export LESS_TERMCAP_mb=$'\e[1;32m'
export LESS_TERMCAP_md=$'\e[1;32m'
export LESS_TERMCAP_me=$'\e[0m'
export LESS_TERMCAP_se=$'\e[0m'
export LESS_TERMCAP_so=$'\e[01;33m'
export LESS_TERMCAP_ue=$'\e[0m'
# export LESS_TERMCAP_us=$'\e[1;4;31m'source ~/powerlevel10k/powerlevel10k.zsh-theme

# for Volta to work with React Native
unset _VOLTA_TOOL_RECURSION

export ANDROID_HOME=~/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools

# use ruby from rbenv, not system's ruby
export PATH="$HOME/.rbenv/bin:$PATH"
eval "$(rbenv init - zsh)"
