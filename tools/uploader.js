/*
 *  Amazon S3 updater
 *
 *  This script handles the transfer of assets from the local machine to Amazon's S3 buckets.
 *
 *  To operate the following environment variables need to be set:
 *
 *    S3_KEY    - Amazon user access key
 *    S3_SECRET - Amazon secret user access key
 *    S3_REGION - Region identifier [us-east-1]
 *    S3_BUCKET - Bucket name
 *
 *  The S3_KEY and S3_SECRET are available from the IAM console in AWS
 */

var fs = require('fs')
var path = require('path')
var async = require('async')

var AWS = require('aws-sdk')

var args = require('yargs')
    .usage('node tools/uploader.js --source=/full/directory/to/browser-laptop --send')
    .default('source', '../browser-laptop')
    .default('send', false)
    .argv

// Default bucket and region
const S3_BUCKET = process.env.S3_BUCKET || 'brave-download'
const S3_REGION = process.env.S3_REGION || 'us-east-1'

// Check that the source directory for the binary assets exists
if (!fs.existsSync(args.source)) {
  throw new Error(args.source + ' does not exist')
}

// Read in package.json
var pack = JSON.parse(fs.readFileSync(path.join(args.source, 'package.json'), 'utf-8'))
var version = pack.version

// Recipe pairs containing local relative paths to files and key locations on S3
var recipes = [
  ['Brave-darwin-x64/Brave-VERSION.zip', 'releases/VERSION/osx'],
  ['dist/Brave.dmg', 'releases/VERSION/osx'],
  ['win64-dist/BraveSetup.exe', 'releases/VERSION/winx64'],
  ['win64-dist/setup.msi', 'releases/VERSION/winx64'],
  ['win64-dist/BraveSetup.exe', 'releases/winx64'],
  ['win64-dist/RELEASES', 'releases/winx64'],
  ['win64-dist/Brave-VERSION-full.nupkg', 'releases/winx64']
]

// Replace VERSION in the recipes with the package version
recipes = recipes.map((recipe) => {
  return [recipe[0].replace('VERSION', version),
          recipe[1].replace('VERSION', version)]
})

console.log('Working with version: ' + version)

// Check for S3 env variables
if (!process.env.S3_KEY || !process.env.S3_SECRET) {
  throw new Error('S3_KEY or S3_SECRET environment variables not set')
}

AWS.config.update({
  accessKeyId: process.env.S3_KEY,
  secretAccessKey: process.env.S3_SECRET,
  region: S3_REGION,
  sslEnabled: true
})

// Return a function used to transfer a file to S3
var makeS3Uploader = (filename, s3Key) => {
  return (cb) => {
    // Check to see that the file exists
    if (fs.existsSync(filename)) {
      // Transfer parameters
      var params = {
        localFile: filename,
        s3Params: {
          Bucket: S3_BUCKET,
          Key: s3Key + '/' + path.basename(filename),
          ACL: 'public-read'
        }
      }
      console.log(params)

      var body = fs.createReadStream(filename)
      var s3obj = new AWS.S3({
        params: {
          Bucket: S3_BUCKET,
          Key: s3Key + '/' + path.basename(filename),
          ACL: 'public-read'
        }
      })

      var lastPercent = 0
      s3obj.upload({Body: body}).
        on('httpUploadProgress', function(evt) {
          var percent = Math.round(evt.loaded / evt.total * 100)
          if (lastPercent !== percent) {
            process.stdout.write(percent + '% ')
            lastPercent = percent
          }
        }).
        send((err, data) => {
          console.log('Done')
          console.log(data)
          cb(err)
        })

    } else {
      console.log('IGNORING - ' + filename + ' does not exist')
      cb(null)
    }
  }
}

// Return a function used to report on the status of a file
var makeReporter = (filename) => {
  return (cb) => {
    if (fs.existsSync(filename)) {
      console.log('OK       - ' + filename + ' exists')
    } else {
      console.log('IGNORING - ' + filename + ' does not exist')
    }
    cb(null)
  }
}

// Create array of function handlers
var recipeHandlers = recipes.map((recipe) => {
  var fullFilename = path.join(args.source, recipe[0])
  if (args.send) {
    return makeS3Uploader(fullFilename, recipe[1])
  } else {
    return makeReporter(fullFilename)
  }
})

// Call the function handlers
async.series(recipeHandlers, (err, handler) => {
  if (err) {
    throw new Error(err)
  }
  console.log("* Process complete")
})
