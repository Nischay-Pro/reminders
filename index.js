// Use UTC for for all Date parsing
process.env.TZ = 'UTC'

const fs = require('fs');
const createScheduler = require('probot-scheduler');
const Freeze = require('./lib/freeze');
const formatParser = require('./lib/format-parser');
const githubHelper = require('./lib/github-helper');
const parseReminder = require('parse-reminder');
const commands = require('./lib/commands');

/* Configuration Variables */

module.exports = robot => {
  commands(robot, 'remind', async (context, command) => {
    const reminder = parseReminder(command.name + ' ' + command.arguments);

    if (reminder) {
      if (reminder.who === 'me') {
        reminder.who = context.payload.comment.user.login;
      }

      const config = await context.config('probot-snooze.yml', JSON.parse(fs.readFileSync('./etc/defaults.json', 'utf8')));
      const freeze = new Freeze(context.github, config);

      freeze.freeze(context, {
        assignee: reminder.who,
        unfreezeMoment: reminder.when,
        message: reminder.what
      });
    }
  });

  robot.on('integration_installation.added', installationEvent);

  robot.on('issue_comment', handleFreeze);
  createScheduler(robot);

  robot.on('schedule.repository', handleThaw);

  async function installationEvent(context) {
    const config = await context.config('probot-snooze.yml', JSON.parse(fs.readFileSync('./etc/defaults.json', 'utf8')));

    context.github.issues.getLabel(context.repositories_added[0]({
      name: config.labelName}).catch(() => {
        return context.github.issues.createLabel(context.repositories_added[0]({
          name: config.labelName,
          color: config.labelColor
        }));
      }));
  }

  async function handleFreeze(context) {
    const config = await context.config('probot-snooze.yml', JSON.parse(fs.readFileSync('./etc/defaults.json', 'utf8')));
    const freeze = new Freeze(context.github, config);

    const comment = context.payload.comment;
    freeze.config.perform = true;
    if (freeze.config.perform && !context.isBot && freeze.freezable(comment)) {
      freeze.freeze(
        context,
        freeze.propsHelper(comment.user.login, comment.body)
    );
    }
  }

  async function handleThaw(context) {
    const config = await context.config('probot-snooze.yml', JSON.parse(fs.readFileSync('./etc/defaults.json', 'utf8')));

    const freeze = new Freeze(context.github, config);
    const {owner, repo} = context.repo();
    const q = `label:"${freeze.config.labelName}" repo:${owner}/${repo}`;

    context.github.search.issues({q}).then(resp => {
      resp.data.items.forEach(issue => {
        context.github.issues.getComments(githubHelper.parseCommentURL(issue.comments_url)).then(resp => {
          return freeze.getLastFreeze(resp.data);
        }).then(lastFreezeComment => {
          if (freeze.unfreezable(lastFreezeComment)) {
            freeze.unfreeze(issue, formatParser.propFromComment(lastFreezeComment));
          }
        });
      });
    });
    console.log('scheduled thaw run complete');
  }
};
