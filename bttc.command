cd /Users/danohlsen/Sites/bttc_web

read -p "Be sure to save any uncommitted changes in the repo before continuing.
Press enter to continue:"

# discard any uncommitted changes to repo
git reset --hard
git clean -f -d

# switch to main branch
git checkout main

# pull down the latest of main branch (local copy now matches what is on the website)
git pull

echo "Enter a new results branch name (ie results-2024May10):"
read name

# create a new branch and switch to it
git checkout -b "$name"

read -p "Add results PDF, edit results index, then press enter to continue:"

# stage all changed files to be committed
git add .

# commit the changes to the new branch
git commit -m "added results for $name"

# push the new branch to the github repo
git push --set-upstream origin "$name"

# open a new Pull Request (PR) of this branch against main
# to merge it into the main branch in the github repo
# (as opposed to merging the new branch into main locally and pushing up the changed main branch)
open "https://github.com/berkeleyttc/bttc_web/compare/main...${name}?title=added%20results%20for%20${name}&expand=1&body=added%20results%20for%20${name}"

echo "Branch $name was pushed upstream. Click create pull request in the browser window that opened."