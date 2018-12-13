const http = require('http');
const express = require('express');
const { createMessageAdapter } = require('@slack/interactive-messages');
const { WebClient } = require('@slack/client');
const { createEventAdapter } = require('@slack/events-api');
const bodyParser = require('body-parser')
// const { users, neighborhoods } = require('./models');
const config = require('./config')
const axios = require('axios');

// Read the verification token from the environment variables
// const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET, {
  includeBody: true
});
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackAccessToken = process.env.SLACK_ACCESS_TOKEN;
if (!slackSigningSecret || !slackAccessToken) {
  throw new Error('A Slack signing secret and access token are required to run this app.');
}

// Initialize a data structures to store team authorization info (typically stored in a database)
const botAuthorizations = {}

// Initialize Add to Slack (OAuth) helpers
passport.use(new SlackStrategy({
  clientID: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  skipUserProfile: true,
}, (accessToken, scopes, team, extra, profiles, done) => {
  botAuthorizations[team.id] = extra.bot.accessToken;
  done(null, {});
}));

// Create the adapter using the app's verification token
const slackInteractions = createMessageAdapter(slackSigningSecret);

// Create a Slack Web API client
const web = new WebClient(slackAccessToken);

// Initialize an Express application
const app = express();

if (config('PROXY_URI')) {
  app.use(proxy(config('PROXY_URI'), {
    forwardPath: (req, res) => { return require('url').parse(req.url).path }
  }))
}

// Plug the Add to Slack (OAuth) helpers into the express app
app.use(passport.initialize());
app.get('/', (req, res) => {
  res.send('<a href="/auth/slack"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>');
});
app.get('/auth/slack', passport.authenticate('slack', {
  scope: ['bot']
}));
app.get('/auth/slack/callback',
  passport.authenticate('slack', { session: false }),
  (req, res) => {
    res.send('<p>Greet and React was successfully installed on your team.</p>');
  },
  (err, req, res, next) => {
    res.status(500).send(`<p>Greet and React failed to install</p> <pre>${err}</pre>`);
  }
);

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

//Testing to make sure the server is alive.
app.get('/', (req, res) => { res.send('\n rahulAPI is ALIIIVE \n') })

// Attach the adapter to the Express application as a middleware
app.use('/slack/actions', slackInteractions.expressMiddleware());
app.use('/slack/events', slackEvents.expressMiddleware());

// Attach the slash command handler
app.post('/slack/commands', slackSlashCommand);

// *** Handle errors ***
slackEvents.on('error', (error) => {
  if (error.code === slackEventsApi.errorCodes.TOKEN_VERIFICATION_FAILURE) {
    // This error type also has a `body` propery containing the request body which failed verification.
    console.error(`An unverified request was sent to the Slack events Request URL. Request body: \
${JSON.stringify(error.body)}`);
  } else {
    console.error(`An error occurred while handling a Slack event: ${error.message}`);
  }
});

// Start the express application server
const port = process.env.PORT || 8000;
http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});

// app.listen(config('PORT'), (err) => {
//   if (err) throw err

//   console.log(`\n rahulAPI on PORT ${config('PORT')} `)

//   if (config('SLACK_ACCESS_TOKEN')) {
//     console.log(`@rahulAPI is real-time\n`)
//     bot.listen({ token: config('SLACK_ACCESS_TOKEN') })
//   }
// })
/* >>>>>>>>>>>Slack Event Handlers<<<<<<<<<<<<<< */ 
// *** Greeting any user that says "hi" ***
slackEvents.on('message', (message, body) => {
  // Only deal with messages that have no subtype (plain messages) and contain 'hi'
  if (!message.subtype && message.text.indexOf('hi') >= 0) {
    // Initialize a client
    const slack = getClientByTeamId(body.team_id);
    // Handle initialization failure
    if (!slack) {
      return console.error('No authorization found for this team. Did you install this app again after restarting?');
    }
    // Respond to the message back in the same channel
    slack.chat.postMessage({ channel: message.channel, text: `Hello <@${message.user}>! :tada:` })
      .catch(console.error);
  }
});

// *** Responding to reactions with the same emoji ***
slackEvents.on('reaction_added', (event, body) => {
  // Initialize a client
  const slack = getClientByTeamId(body.team_id);
  // Handle initialization failure
  if (!slack) {
    return console.error('No authorization found for this team. Did you install this app again after restarting?');
  }
  // Respond to the reaction back with the same emoji
  slack.chat.postMessage(event.item.channel, `:${event.reaction}:`)
    .catch(console.error);
});

/* >>>>>>Slack interactive message handlers<<<<<< */
slackInteractions.action('accept_tos', (payload, respond) => {
  console.log(`The user ${payload.user.name} in team ${payload.team.domain} pressed a button`);

  // Use the data model to persist the action
  users.findBySlackId(payload.user.id)
    .then(user => user.setPolicyAgreementAndSave(payload.actions[0].value === 'accept'))
    .then((user) => {
      // After the asynchronous work is done, call `respond()` with a message object to update the
      // message.
      let confirmation;
      if (user.agreedToPolicy) {
        confirmation = 'Thank you for agreeing to the terms of service';
      } else {
        confirmation = 'You have denied the terms of service. You will no longer have access to this app.';
      }
      respond({ text: confirmation });
    })
    .catch((error) => {
      // Handle errors
      console.error(error);
      respond({
        text: 'An error occurred while recording your agreement choice.'
      });
    });

  // Before the work completes, return a message object that is the same as the original but with
  // the interactive elements removed.
  const reply = payload.original_message;
  delete reply.attachments[0].actions;
  return reply;
});

slackInteractions
  .options({ callbackId: 'pick_sf_neighborhood', within: 'interactive_message' }, (payload) => {
    console.log(`The user ${payload.user.name} in team ${payload.team.domain} has requested options`);

    // Gather possible completions using the user's input
    return neighborhoods.fuzzyFind(payload.value)
      // Format the data as a list of options
      .then(formatNeighborhoodsAsOptions)
      .catch((error) => {
        console.error(error);
        return { options: [] };
      });
  })
  .action('pick_sf_neighborhood', (payload, respond) => {
    console.log(`The user ${payload.user.name} in team ${payload.team.domain} selected from a menu`);

    // Use the data model to persist the action
    neighborhoods.find(payload.actions[0].selected_options[0].value)
      // After the asynchronous work is done, call `respond()` with a message object to update the
      // message.
      .then((neighborhood) => {
        respond({
          text: payload.original_message.text,
          attachments: [{
            title: neighborhood.name,
            title_link: neighborhood.link,
            text: 'One of the most interesting neighborhoods in the city.',
          }],
        });
      })
      .catch((error) => {
        // Handle errors
        console.error(error);
        respond({
          text: 'An error occurred while finding the neighborhood.'
        });
      });

    // Before the work completes, return a message object that is the same as the original but with
    // the interactive elements removed.
    const reply = payload.original_message;
    delete reply.attachments[0].actions;
    return reply;
  });

slackInteractions.action({ type: 'dialog_submission' }, (payload, respond) => {
  // `payload` is an object that describes the interaction
  console.log(`The user ${payload.user.name} in team ${payload.team.domain} submitted a dialog`);

  // Check the values in `payload.submission` and report any possible errors
  const errors = validateKudosSubmission(payload.submission);
  if (errors) {
    return errors;
  } else {
    setTimeout(() => {
      const partialMessage = `<@${payload.user.id}> just gave kudos to <@${payload.submission.user}>.`;

      // When there are no errors, after this function returns, send an acknowledgement to the user
      respond({
        text: partialMessage,
      });

      // The app does some work using information in the submission
      users.findBySlackId(payload.submission.id)
        .then(user => user.incrementKudosAndSave(payload.submission.comment))
        .then((user) => {
          // After the asynchronous work is done, call `respond()` with a message object to update
          // the message.
          respond({
            text: `${partialMessage} That makes a total of ${user.kudosCount}! :balloon:`,
            replace_original: true,
          });
        })
        .catch((error) => {
          // Handle errors
          console.error(error);
          respond({ text: 'An error occurred while incrementing kudos.' });
        });
    });
  }
});


// Example interactive messages
const interactiveButtons = {
  text: 'The terms of service for this app are _not really_ here: <https://unsplash.com/photos/bmmcfZqSjBU>',
  response_type: 'in_channel',
  attachments: [{
    text: 'Do you accept the terms of service?',
    callback_id: 'accept_tos',
    actions: [
      {
        name: 'accept_tos',
        text: 'Yes',
        value: 'accept',
        type: 'button',
        style: 'primary',
      },
      {
        name: 'accept_tos',
        text: 'No',
        value: 'deny',
        type: 'button',
        style: 'danger',
      },
    ],
  }],
};

const interactiveMenu = {
  text: 'San Francisco is a diverse city with many different neighborhoods.',
  response_type: 'in_channel',
  attachments: [{
    text: 'Explore San Francisco',
    callback_id: 'pick_sf_neighborhood',
    actions: [{
      name: 'neighborhood',
      text: 'Choose a neighborhood',
      type: 'select',
      data_source: 'external',
    }],
  }],
};

const dialog = {
  callback_id: 'kudos_submit',
  title: 'Give kudos',
  submit_label: 'Give',
  elements: [
    {
      label: 'Teammate',
      type: 'select',
      name: 'user',
      data_source: 'users',
      placeholder: 'Teammate Name'
    },
    {
      label: 'Comment',
      type: 'text',
      name: 'comment',
      placeholder: 'Thanks for helping me with my project!',
      hint: 'Describe why you think your teammate deserves kudos.',
    },
  ],
};

// Slack slash command handler
function slackSlashCommand(req, res, next) {
  if (req.body.token === slackVerificationToken && req.body.command === '/interactive-example') {
    const type = req.body.text.split(' ')[0];
    if (type === 'button') {
      res.json(interactiveButtons);
    } else if (type === 'menu') {
      res.json(interactiveMenu);
    } else if (type === 'dialog') {
      res.send();
      web.dialog.open({
        trigger_id: req.body.trigger_id,
        dialog,
      }).catch((error) => {
        return axios.post(req.body.response_url, {
          text: `An error occurred while opening the dialog: ${error.message}`,
        });
      }).catch(console.error);
    } else {
      res.send('Use this command followed by `button`, `menu`, or `dialog`.');
    }
  } else {
    next();
  }
}

// Helpers
function formatNeighborhoodsAsOptions(neighborhoods) {
  return {
    options: neighborhoods.map(n => ({ text: n.name, value: n.name })),
  };
}

function validateKudosSubmission(submission) {
  let errors = [];
  if (!submission.comment.trim()) {
    errors.push({
      name: 'comment',
      error: 'The comment cannot be empty',
    });
  }
  if (errors.length > 0) {
    return { errors };
  }
}