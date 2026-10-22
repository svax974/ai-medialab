#!/bin/zsh
# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT
#
# Usage: guarded_run.sh <max_rss_gb> <cmd...>
# Runs a command and kills its whole process tree when the tree RSS exceeds <max_rss_gb> GB or when the
# available memory of the Mac (free + inactive + speculative + purgeable pages) drops below 4 GB. macOS only.
MAX=$1; shift
avail_gb() { vm_stat | awk '/page size of/{ps=$8} /Pages free/{f=$3} /Pages inactive/{i=$3} /Pages speculative/{s=$3} /Pages purgeable/{p=$3} END{printf "%.2f",(f+i+s+p)*ps/1073741824}'; }
tree_rss_gb() { ps -axo pid,ppid,rss | awk -v root="$1" '{par[$1]=$2; rss[$1]=$3} END{t=0; for(p in rss){q=p; while(q>1){ if(q==root){t+=rss[p];break} q=par[q]}} printf "%.2f", t/1048576}'; }
"$@" &
PID=$!; peak=0; t0=$SECONDS
while kill -0 $PID 2>/dev/null; do
  a=$(avail_gb); r=$(tree_rss_gb $PID); (( r > peak )) && peak=$r
  if (( a < 4.0 )) || (( r > MAX )); then pkill -KILL -P $PID 2>/dev/null; kill -KILL $PID 2>/dev/null; echo "ABORT memory: available ${a} GB, tree RSS ${r} GB"; exit 99; fi
  sleep 0.3
done
wait $PID; echo "exit=$? duration=$((SECONDS-t0))s peak RSS=${peak} GB available at end=$(avail_gb) GB"
